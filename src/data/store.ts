// Local-first record store backed by IndexedDB. Every change is kept locally and
// marked "dirty" until the sync client confirms the hub has it.
import { openDB, type IDBPDatabase } from 'idb';
import { COLLECTIONS, type CollectionMap, type CollectionName, type SyncRecord } from '../core/types';
import { newer } from '../core/sync';
import { uid } from '../core/money';

interface StoredRecord extends SyncRecord {
  dirty: boolean;
}

type Listener = () => void;

const DB_NAME = 'pebbles';

export class Store {
  private db: IDBPDatabase | null = null;
  private recs = new Map<string, StoredRecord>();
  private byCol = new Map<CollectionName, Map<string, StoredRecord>>();
  private listeners = new Set<Listener>();
  private changeListeners = new Set<Listener>();
  private cache = new Map<CollectionName, unknown[]>();
  version = 0;
  deviceId = '';
  ready = false;
  private clock = 0;

  async init(): Promise<void> {
    for (const c of COLLECTIONS) this.byCol.set(c, new Map());
    try {
      this.db = await openDB(DB_NAME, 1, {
        upgrade(db) {
          db.createObjectStore('records', { keyPath: 'key' });
          db.createObjectStore('meta', { keyPath: 'id' });
        },
      });
      const all = (await this.db.getAll('records')) as StoredRecord[];
      for (const r of all) this.index(r);
      let dev = (await this.db.get('meta', 'deviceId'))?.value as string | undefined;
      if (!dev) {
        dev = uid('dev_');
        await this.db.put('meta', { id: 'deviceId', value: dev });
      }
      this.deviceId = dev;
    } catch (e) {
      console.warn('IndexedDB unavailable, running in memory only', e);
      this.deviceId = uid('dev_');
    }
    this.ready = true;
    this.bump();
  }

  private index(r: StoredRecord) {
    this.recs.set(r.key, r);
    const m = this.byCol.get(r.collection) ?? new Map();
    this.byCol.set(r.collection, m);
    if (r.deleted) m.delete(r.id);
    else m.set(r.id, r);
    this.cache.delete(r.collection);
    if (r.updatedAt > this.clock) this.clock = r.updatedAt;
  }

  private bump() {
    this.version++;
    for (const l of this.listeners) l();
  }

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  /** Called after local edits (used to trigger sync). */
  onLocalChange(l: Listener): () => void {
    this.changeListeners.add(l);
    return () => this.changeListeners.delete(l);
  }

  getVersion = () => this.version;

  get<C extends CollectionName>(c: C, id: string): CollectionMap[C] | undefined {
    return this.byCol.get(c)?.get(id)?.data as CollectionMap[C] | undefined;
  }

  list<C extends CollectionName>(c: C): CollectionMap[C][] {
    const hit = this.cache.get(c);
    if (hit) return hit as CollectionMap[C][];
    const arr = [...(this.byCol.get(c)?.values() ?? [])].map((r) => r.data as CollectionMap[C]);
    this.cache.set(c, arr);
    return arr;
  }

  private now(): number {
    // monotonic clock so quick successive edits always order correctly
    this.clock = Math.max(Date.now(), this.clock + 1);
    return this.clock;
  }

  async putMany<C extends CollectionName>(c: C, items: (CollectionMap[C] & { id: string })[]): Promise<void> {
    const out: StoredRecord[] = items.map((data) => ({
      key: `${c}:${data.id}`,
      collection: c,
      id: data.id,
      updatedAt: this.now(),
      deviceId: this.deviceId,
      deleted: false,
      data: JSON.parse(JSON.stringify(data)),
      dirty: true,
    }));
    await this.write(out);
  }

  put<C extends CollectionName>(c: C, data: CollectionMap[C] & { id: string }): Promise<void> {
    return this.putMany(c, [data]);
  }

  async remove(c: CollectionName, ids: string | string[]): Promise<void> {
    const list = Array.isArray(ids) ? ids : [ids];
    const out: StoredRecord[] = list.map((id) => ({
      key: `${c}:${id}`,
      collection: c,
      id,
      updatedAt: this.now(),
      deviceId: this.deviceId,
      deleted: true,
      data: null,
      dirty: true,
    }));
    await this.write(out);
  }

  private async write(out: StoredRecord[]) {
    for (const r of out) this.index(r);
    this.bump();
    if (this.db) {
      const tx = this.db.transaction('records', 'readwrite');
      for (const r of out) tx.store.put(r);
      await tx.done;
    }
    for (const l of this.changeListeners) l();
  }

  dirty(): SyncRecord[] {
    return [...this.recs.values()].filter((r) => r.dirty).map(({ dirty: _d, ...r }) => r);
  }

  /** Mark records clean if they haven't changed since they were sent. */
  async markClean(sent: SyncRecord[]): Promise<void> {
    const cleaned: StoredRecord[] = [];
    for (const s of sent) {
      const cur = this.recs.get(s.key);
      if (cur && cur.dirty && cur.updatedAt === s.updatedAt && cur.deviceId === s.deviceId) {
        cur.dirty = false;
        cleaned.push(cur);
      }
    }
    if (this.db && cleaned.length) {
      const tx = this.db.transaction('records', 'readwrite');
      for (const r of cleaned) tx.store.put(r);
      await tx.done;
    }
  }

  /** Apply records that came from the hub. */
  async applyRemote(incoming: SyncRecord[]): Promise<number> {
    const changed: StoredRecord[] = [];
    for (const r of incoming) {
      const cur = this.recs.get(r.key);
      if (newer(cur, r)) {
        const rec: StoredRecord = { ...r, dirty: false };
        this.index(rec);
        changed.push(rec);
      }
    }
    if (changed.length) {
      this.bump();
      if (this.db) {
        const tx = this.db.transaction('records', 'readwrite');
        for (const r of changed) tx.store.put(r);
        await tx.done;
      }
    }
    return changed.length;
  }

  async getMeta<T>(id: string): Promise<T | undefined> {
    if (!this.db) return (this.memMeta.get(id) as T) ?? undefined;
    return (await this.db.get('meta', id))?.value as T | undefined;
  }

  private memMeta = new Map<string, unknown>();

  async setMeta(id: string, value: unknown): Promise<void> {
    if (!this.db) {
      this.memMeta.set(id, value);
      return;
    }
    await this.db.put('meta', { id, value });
  }

  /** Every live record (for backups/export). */
  exportAll(): SyncRecord[] {
    return [...this.recs.values()].filter((r) => !r.deleted).map(({ dirty: _d, ...r }) => r);
  }

  /** Restore from a backup: records become fresh local edits so they sync everywhere. */
  async importAll(records: SyncRecord[]): Promise<void> {
    const out: StoredRecord[] = records
      .filter((r) => r && r.collection && r.id && !r.deleted && COLLECTIONS.includes(r.collection))
      .map((r) => ({ ...r, key: `${r.collection}:${r.id}`, updatedAt: this.now(), deviceId: this.deviceId, dirty: true }));
    await this.write(out);
  }

  async wipe(): Promise<void> {
    if (this.db) {
      await this.db.clear('records');
    }
    this.recs.clear();
    for (const c of COLLECTIONS) this.byCol.set(c, new Map());
    this.cache.clear();
    this.bump();
  }
}

export const store = new Store();
