// The Pebbles hub: the desktop's copy of everything, plus the LAN sync server
// your phone talks to. Plain Node (no Electron imports) so it can be tested alone.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { promises as fs } from 'node:fs';
import { hostname, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { deriveToken, makeOffer, newer, open, pairKeys, pairingCode, seal, tokenId, verifyOffer, fromB64, type Sealed, type SyncRequest, type SyncResponse } from '../src/core/sync';
import type { SyncRecord } from '../src/core/types';

export const HUB_PORT = 47821;
const MAX_BODY = 60 * 1024 * 1024;
const PAGE = 1500;

interface StoredRecord extends SyncRecord {
  seq: number;
}

export interface Device {
  id: string;
  name: string;
  tokenId: string;
  token: string;
  pairedAt: number;
  lastSeen: number | null;
}

interface HubFile {
  version: 1;
  hubId: string;
  hubName: string;
  seq: number;
  records: Record<string, StoredRecord>;
  devices: Device[];
}

export class Hub {
  private data!: HubFile;
  private saveTimer: NodeJS.Timeout | null = null;
  private server: Server | null = null;
  port = HUB_PORT;
  private pairing: { code: string; expiresAt: number; attempts: number } | null = null;
  onChange: (source: string) => void = () => {};
  onPaired: (d: Device) => void = () => {};

  constructor(private dir: string) {}

  get file() {
    return join(this.dir, 'pebbles-hub.json');
  }

  async load(): Promise<void> {
    await fs.mkdir(join(this.dir, 'backups'), { recursive: true });
    try {
      this.data = JSON.parse(await fs.readFile(this.file, 'utf8')) as HubFile;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        // keep the unreadable file aside and try the newest backup
        await fs.rename(this.file, this.file + `.corrupt-${Date.now()}`).catch(() => {});
        const restored = await this.newestBackup();
        if (restored) {
          this.data = restored;
          return;
        }
      }
      this.data = { version: 1, hubId: randomBytes(9).toString('hex'), hubName: friendlyHost(), seq: 0, records: {}, devices: [] };
      await this.saveNow();
    }
  }

  private async newestBackup(): Promise<HubFile | null> {
    const files = (await fs.readdir(join(this.dir, 'backups')).catch(() => [] as string[])).filter((f) => f.endsWith('.json')).sort().reverse();
    for (const f of files) {
      try {
        return JSON.parse(await fs.readFile(join(this.dir, 'backups', f), 'utf8')) as HubFile;
      } catch {
        /* try the next */
      }
    }
    return null;
  }

  info() {
    return { hubId: this.data.hubId, hubName: this.data.hubName, port: this.port, addresses: lanAddresses(), dataPath: this.dir };
  }

  // ---------------- records ----------------

  sync(req: SyncRequest, source = req.deviceId): SyncResponse & { more: boolean } {
    const accepted = new Set<string>();
    for (const r of req.changes ?? []) {
      if (!r || typeof r.key !== 'string' || typeof r.updatedAt !== 'number') continue;
      const cur = this.data.records[r.key];
      if (newer(cur, r)) {
        this.data.records[r.key] = { ...r, seq: ++this.data.seq };
        accepted.add(r.key);
      }
    }
    if (accepted.size) {
      this.scheduleSave();
      this.onChange(source);
    }
    const since = Number(req.since) || 0;
    const pending = Object.values(this.data.records)
      .filter((r) => r.seq > since && !(accepted.has(r.key) && r.deviceId === req.deviceId))
      .sort((a, b) => a.seq - b.seq);
    const page = pending.slice(0, PAGE);
    const more = pending.length > PAGE;
    const seq = more ? page[page.length - 1].seq : this.data.seq;
    return { hubId: this.data.hubId, seq, changes: page.map(({ seq: _s, ...r }) => r), serverTime: Date.now(), more };
  }

  // ---------------- devices & pairing ----------------

  startPairing() {
    this.pairing = { code: pairingCode(), expiresAt: Date.now() + 10 * 60_000, attempts: 0 };
    return { code: this.pairing.code, expiresAt: this.pairing.expiresAt, addresses: lanAddresses(), port: this.port, hubName: this.data.hubName };
  }

  stopPairing() {
    this.pairing = null;
  }

  devices() {
    return this.data.devices.map(({ id, name, pairedAt, lastSeen }) => ({ id, name, pairedAt, lastSeen }));
  }

  revoke(id: string) {
    this.data.devices = this.data.devices.filter((d) => d.id !== id);
    this.scheduleSave();
  }

  async pair(body: { deviceId: string; deviceName: string; pub: string; mac: string }): Promise<{ status: number; json?: unknown }> {
    const p = this.pairing;
    if (!p || Date.now() > p.expiresAt) return { status: 410 };
    if (p.attempts >= 8) {
      this.pairing = null;
      return { status: 429 };
    }
    p.attempts++;
    if (!(await verifyOffer(p.code, { pub: body.pub, mac: body.mac }).catch(() => false))) return { status: 403 };
    const { keys, pubRaw } = await pairKeys();
    const reply = await makeOffer(p.code, pubRaw, fromB64(body.pub));
    const token = await deriveToken(keys.privateKey, body.pub);
    const device: Device = {
      id: String(body.deviceId || randomBytes(6).toString('hex')).slice(0, 64),
      name: String(body.deviceName || 'Phone').slice(0, 60),
      tokenId: await tokenId(token),
      token,
      pairedAt: Date.now(),
      lastSeen: null,
    };
    this.data.devices = [...this.data.devices.filter((d) => d.id !== device.id), device];
    this.pairing = null;
    await this.saveNow();
    this.onPaired(device);
    return { status: 200, json: { ...reply, hubId: this.data.hubId, hubName: this.data.hubName } };
  }

  // ---------------- HTTP ----------------

  async listen(): Promise<number> {
    for (let port = HUB_PORT; port < HUB_PORT + 10; port++) {
      try {
        await new Promise<void>((resolve, reject) => {
          const srv = createServer((req, res) => void this.handle(req, res));
          srv.once('error', reject);
          srv.listen(port, '0.0.0.0', () => {
            this.server = srv;
            resolve();
          });
        });
        this.port = port;
        return port;
      } catch {
        /* port taken, try the next */
      }
    }
    throw new Error('No free port for the Pebbles sync server');
  }

  close() {
    this.server?.close();
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, X-Pebbles-Token',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Private-Network': 'true',
    };
    const send = (status: number, json?: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors });
      res.end(JSON.stringify(json ?? { ok: status < 400, status }));
    };
    try {
      const url = (req.url ?? '/').split('?')[0];
      if (req.method === 'OPTIONS') {
        res.writeHead(204, cors);
        return res.end();
      }
      if (req.method === 'GET' && url === '/hello') return send(200, { app: 'pebbles', hubId: this.data.hubId, name: this.data.hubName, version: 1 });
      if (req.method !== 'POST') return send(404);
      const raw = await readBody(req);
      if (url === '/pair') {
        const r = await this.pair(JSON.parse(raw));
        return send(r.status, r.json);
      }
      if (url === '/sync') {
        const id = String(req.headers['x-pebbles-token'] ?? '');
        const device = this.data.devices.find((d) => d.tokenId === id);
        if (!device) return send(401);
        const request = await open<SyncRequest>(device.token, JSON.parse(raw) as Sealed);
        const result = this.sync({ ...request, deviceId: device.id }, device.id);
        device.lastSeen = Date.now();
        this.scheduleSave();
        return send(200, await seal(device.token, result));
      }
      return send(404);
    } catch (e) {
      return send(400, { error: (e as Error).message });
    }
  }

  // ---------------- persistence ----------------

  private scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.saveNow(), 600);
  }

  async saveNow(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    const text = JSON.stringify(this.data);
    const tmp = this.file + '.tmp';
    try {
      await fs.writeFile(tmp, text, 'utf8');
      // Windows can briefly lock files (antivirus, indexing): retry the swap a few times
      for (let i = 0; ; i++) {
        try {
          await fs.rename(tmp, this.file);
          break;
        } catch (e) {
          if (i >= 5) throw e;
          await new Promise((r) => setTimeout(r, 150 * (i + 1)));
        }
      }
    } catch (e) {
      console.error('Pebbles: atomic save failed, writing directly', e);
      await fs.writeFile(this.file, text, 'utf8').catch((err) => console.error('Pebbles: save failed', err));
    }
    await this.dailyBackup(text).catch((e) => console.error('Pebbles: backup failed', e));
  }

  private async dailyBackup(text: string) {
    const day = new Date().toISOString().slice(0, 10);
    const dir = join(this.dir, 'backups');
    const target = join(dir, `pebbles-${day}.json`);
    await fs.writeFile(target, text, 'utf8');
    const files = (await fs.readdir(dir)).filter((f) => /^pebbles-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
    for (const old of files.slice(0, Math.max(0, files.length - 14))) await fs.unlink(join(dir, old)).catch(() => {});
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('Too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) out.push(a.address);
    }
  }
  const rank = (ip: string) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3);
  return out.sort((a, b) => rank(a) - rank(b));
}

function friendlyHost(): string {
  const h = hostname().replace(/\.local$/, '');
  return h.length > 2 ? h : 'My computer';
}
