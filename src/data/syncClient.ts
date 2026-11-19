// Keeps this device in sync with the desktop hub.
//  - On the desktop the window talks to the hub in the same app over IPC.
//  - On the phone it talks to the hub over home Wi-Fi with encrypted HTTP.
import { store } from './store';
import { desktop, deviceName, lanRequest, platformKind } from '../platform';
import { deriveToken, makeOffer, open, pairKeys, seal, tokenId, verifyOffer, type Sealed, type SyncRequest, type SyncResponse } from '../core/sync';
import type { SyncRecord } from '../core/types';

export interface HubLink {
  host: string;
  port: number;
  token: string;
  tokenId: string;
  hubId: string;
  hubName: string;
  pairedAt: number;
}

export type SyncStatus = 'idle' | 'syncing' | 'ok' | 'offline' | 'error' | 'unpaired';

export interface SyncState {
  status: SyncStatus;
  lastSyncAt: number | null;
  message: string;
  hub: HubLink | null;
}

export const DEFAULT_PORT = 47821;
const BATCH = 400;

type Listener = () => void;

class SyncClient {
  state: SyncState = { status: 'idle', lastSyncAt: null, message: '', hub: null };
  private listeners = new Set<Listener>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private again = false;
  private lastScan = 0;

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getState = () => this.state;

  private set(p: Partial<SyncState>) {
    this.state = { ...this.state, ...p };
    for (const l of this.listeners) l();
  }

  async start() {
    const hub = platformKind === 'desktop' ? null : ((await store.getMeta<HubLink>('hub')) ?? null);
    const last = (await store.getMeta<number>('lastSyncAt')) ?? null;
    this.set({ hub, lastSyncAt: last, status: platformKind === 'desktop' || hub ? 'idle' : 'unpaired' });
    store.onLocalChange(() => this.schedule(1200));
    if (desktop) desktop.onRemoteChange(() => this.schedule(150));
    const interval = platformKind === 'desktop' ? 20_000 : 45_000;
    setInterval(() => {
      if (document.visibilityState === 'visible' || platformKind === 'desktop') this.schedule(0);
    }, interval);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.schedule(200);
    });
    this.schedule(300);
  }

  schedule(ms: number) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.syncNow(), ms);
  }

  private canSync(): boolean {
    return platformKind === 'desktop' || !!this.state.hub;
  }

  async syncNow(): Promise<void> {
    if (!this.canSync()) return;
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    this.set({ status: 'syncing' });
    try {
      let rounds = 0;
      let more = true;
      while (more && rounds < 200) {
        rounds++;
        const since = (await store.getMeta<number>('lastSeq')) ?? 0;
        const dirty = store.dirty();
        const changes = dirty.slice(0, BATCH);
        const res = await this.send({ deviceId: store.deviceId, since, changes });
        await store.applyRemote(res.changes);
        await store.markClean(changes);
        const hubKnown = await store.getMeta<string>('hubId');
        if (hubKnown && hubKnown !== res.hubId) {
          // a different hub (e.g. reinstalled desktop): send everything again
          await store.setMeta('lastSeq', 0);
          await store.markAllDirty();
        }
        await store.setMeta('hubId', res.hubId);
        await store.setMeta('lastSeq', res.seq);
        more = dirty.length > BATCH || (res as SyncResponse & { more?: boolean }).more === true;
      }
      const now = Date.now();
      await store.setMeta('lastSyncAt', now);
      this.set({ status: 'ok', lastSyncAt: now, message: '' });
    } catch (e) {
      const msg = (e as Error).message || String(e);
      const offline = /timeout|network|failed to fetch|abort|unreachable|refused|connect|ECONN|host/i.test(msg);
      this.set({ status: offline ? 'offline' : 'error', message: offline ? 'Not on the same Wi-Fi as your computer' : msg });
      if (offline && platformKind !== 'desktop' && Date.now() - this.lastScan > 10 * 60_000) {
        this.lastScan = Date.now();
        void this.rediscover();
      }
    } finally {
      this.running = false;
      if (this.again) {
        this.again = false;
        this.schedule(500);
      }
    }
  }

  private async send(req: SyncRequest): Promise<SyncResponse & { more?: boolean }> {
    if (desktop) return desktop.sync(req);
    const hub = this.state.hub;
    if (!hub) throw new Error('Not paired');
    const body = JSON.stringify(await seal(hub.token, req));
    const res = await lanRequest(`http://${hub.host}:${hub.port}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Pebbles-Token': hub.tokenId },
      body,
    }, 8000);
    if (res.status === 401) {
      this.set({ status: 'error', message: 'This phone was unpaired on the computer. Pair again in Settings.' });
      throw new Error('Unpaired by computer');
    }
    if (res.status !== 200) throw new Error(`Computer replied ${res.status}`);
    return open<SyncResponse & { more?: boolean }>(hub.token, JSON.parse(res.text) as Sealed);
  }

  /** Pair this phone with the desktop using the address and 6-digit code it shows. */
  async pair(address: string, code: string): Promise<HubLink> {
    // "192.168.1.20:47821" or, from the QR code, several addresses: "192.168.1.20,10.0.0.5:47821"
    const [hostsRaw, portRaw] = address.trim().replace(/^https?:\/\//, '').split(':');
    const hosts = hostsRaw.split(',').map((h) => h.trim()).filter(Boolean);
    const port = Number(portRaw) || DEFAULT_PORT;
    const cleanCode = code.replace(/\D/g, '');
    if (!hosts.length) throw new Error('Enter the address shown on your computer');
    if (cleanCode.length !== 6) throw new Error('The code has 6 digits');
    let host = '';
    let lastErr = '';
    for (const h of hosts) {
      try {
        const hello = await lanRequest(`http://${h}:${port}/hello`, {}, 5000);
        if (hello.status === 200 && /hubId/.test(hello.text)) {
          host = h;
          break;
        }
        lastErr = 'answered, but it isn’t Pebbles';
      } catch (e) {
        lastErr = (e as Error).message || 'no answer';
      }
    }
    if (!host) {
      const refused = /refused|ECONNREFUSED/i.test(lastErr);
      throw new Error(
        refused
          ? `Your computer answered but Pebbles isn’t listening. Make sure Pebbles is open on it, then try again.`
          : `Couldn’t reach your computer at ${hosts.join(' or ')}. Check that: 1) your phone is on the same Wi-Fi as the computer (not mobile data or a guest network), 2) on the computer, Pebbles → Settings → Sync & Devices says phones are allowed through Windows Firewall, 3) the address matches what the computer shows.`,
      );
    }
    const { keys, pubRaw } = await pairKeys();
    const offer = await makeOffer(cleanCode, pubRaw);
    const res = await lanRequest(`http://${host}:${port}/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: store.deviceId, deviceName: deviceName(), ...offer }),
    }, 8000);
    if (res.status === 403) throw new Error('That code didn’t match. Check the code on your computer (it changes every few minutes).');
    if (res.status === 429) throw new Error('Too many tries. Start pairing again on your computer.');
    if (res.status !== 200) throw new Error(`Pairing failed (${res.status}).`);
    const reply = JSON.parse(res.text) as { pub: string; mac: string; hubId: string; hubName: string };
    if (!(await verifyOffer(cleanCode, reply, pubRaw))) throw new Error('The computer’s reply could not be verified.');
    const token = await deriveToken(keys.privateKey, reply.pub);
    const link: HubLink = { host, port, token, tokenId: await tokenId(token), hubId: reply.hubId, hubName: reply.hubName, pairedAt: Date.now() };
    const previousHub = await store.getMeta<string>('hubId');
    await store.setMeta('hub', link);
    await store.setMeta('lastSeq', 0);
    if (previousHub !== reply.hubId) {
      // first time with this computer: send it everything this phone has
      await store.markAllDirty();
      await store.setMeta('hubId', reply.hubId);
    }
    this.set({ hub: link, status: 'idle', message: '' });
    await this.syncNow();
    return link;
  }

  async unpair() {
    await store.setMeta('hub', null);
    this.set({ hub: null, status: 'unpaired', message: '' });
  }

  /** The computer's IP changed? Look for it on the same subnet. */
  async rediscover(): Promise<boolean> {
    const hub = this.state.hub;
    if (!hub || !/^\d+\.\d+\.\d+\.\d+$/.test(hub.host)) return false;
    const prefix = hub.host.split('.').slice(0, 3).join('.');
    const candidates = Array.from({ length: 254 }, (_, i) => `${prefix}.${i + 1}`).filter((h) => h !== hub.host);
    let found: string | null = null;
    const worker = async () => {
      while (candidates.length && !found) {
        const h = candidates.shift()!;
        try {
          const r = await lanRequest(`http://${h}:${hub.port}/hello`, {}, 900);
          if (r.status === 200 && JSON.parse(r.text).hubId === hub.hubId) found = h;
        } catch {
          /* not here */
        }
      }
    };
    await Promise.all(Array.from({ length: 24 }, worker));
    if (found) {
      const link = { ...hub, host: found };
      await store.setMeta('hub', link);
      this.set({ hub: link });
      this.schedule(100);
      return true;
    }
    return false;
  }
}

export const syncClient = new SyncClient();

export type { SyncRecord };
