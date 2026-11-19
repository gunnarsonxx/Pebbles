import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hub } from './hub';
import { deriveToken, makeOffer, open, pairKeys, seal, tokenId, verifyOffer, type SyncResponse } from '../src/core/sync';
import type { SyncRecord } from '../src/core/types';

let hub: Hub;
let dir: string;
let base: string;

const rec = (id: string, updatedAt: number, deviceId: string, data: unknown): SyncRecord => ({
  key: `goals:${id}`,
  collection: 'goals',
  id,
  updatedAt,
  deviceId,
  deleted: false,
  data,
});

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pebbles-hub-'));
  hub = new Hub(dir);
  await hub.load();
  // use a random high port for the test
  (hub as unknown as { port: number }).port = 0;
  const port = await hub.listen();
  base = `http://127.0.0.1:${port}`;
});

afterAll(() => hub.close());

async function phonePair(code: string) {
  const { keys, pubRaw } = await pairKeys();
  const offer = await makeOffer(code, pubRaw);
  const res = await fetch(`${base}/pair`, { method: 'POST', body: JSON.stringify({ deviceId: 'phone1', deviceName: 'Pixel', ...offer }) });
  if (res.status !== 200) return { status: res.status };
  const reply = await res.json();
  expect(await verifyOffer(code, reply, pubRaw)).toBe(true);
  const token = await deriveToken(keys.privateKey, reply.pub);
  return { status: 200, token, reply };
}

async function phoneSync(token: string, since: number, changes: SyncRecord[]) {
  const res = await fetch(`${base}/sync`, {
    method: 'POST',
    headers: { 'X-Pebbles-Token': await tokenId(token) },
    body: JSON.stringify(await seal(token, { deviceId: 'phone1', since, changes })),
  });
  if (res.status !== 200) return { status: res.status } as const;
  return { status: 200, body: await open<SyncResponse & { more: boolean }>(token, await res.json()) } as const;
}

describe('desktop hub', () => {
  let token = '';

  it('answers hello for discovery', async () => {
    const r = await fetch(`${base}/hello`);
    expect((await r.json()).app).toBe('pebbles');
  });

  it('refuses pairing without an active code, and with a wrong code', async () => {
    expect((await phonePair('000000')).status).toBe(410);
    const p = hub.startPairing();
    const wrong = p.code === '111111' ? '222222' : '111111';
    expect((await phonePair(wrong)).status).toBe(403);
  });

  it('pairs with the right code', async () => {
    const p = hub.startPairing();
    const r = await phonePair(p.code);
    expect(r.status).toBe(200);
    token = r.token!;
    expect(hub.devices()).toHaveLength(1);
    // code is single-use
    expect((await phonePair(p.code)).status).toBe(410);
  });

  it('syncs both ways with last-writer-wins', async () => {
    // desktop window writes a goal
    hub.sync({ deviceId: 'desktop-window', since: 0, changes: [rec('ring', 100, 'desktop-window', { name: 'Ring' })] });
    // phone sends its own goal and receives the desktop one
    const r1 = await phoneSync(token, 0, [rec('car', 110, 'phone1', { name: 'Car' })]);
    expect(r1.status).toBe(200);
    const got = r1.body!.changes.map((c) => c.id);
    expect(got).toContain('ring');
    expect(got).not.toContain('car'); // not echoed back to the sender
    // an older phone edit loses to the newer desktop edit
    hub.sync({ deviceId: 'desktop-window', since: 0, changes: [rec('ring', 300, 'desktop-window', { name: 'Ring v2' })] });
    const r2 = await phoneSync(token, r1.body!.seq, [rec('ring', 200, 'phone1', { name: 'Ring old' })]);
    const ring = r2.body!.changes.find((c) => c.id === 'ring')!;
    expect((ring.data as { name: string }).name).toBe('Ring v2');
  });

  it('pages large syncs', async () => {
    const many = Array.from({ length: 3200 }, (_, i) => ({ ...rec(`g${i}`, 1000 + i, 'desktop-window', { i }), key: `transactions:g${i}`, collection: 'transactions' as const }));
    hub.sync({ deviceId: 'desktop-window', since: 0, changes: many });
    let since = 0;
    let total = 0;
    let rounds = 0;
    for (;;) {
      const r = await phoneSync(token, since, []);
      total += r.body!.changes.length;
      since = r.body!.seq;
      rounds++;
      if (!r.body!.more) break;
    }
    expect(rounds).toBeGreaterThan(2);
    expect(total).toBeGreaterThanOrEqual(3200);
  });

  it('persists to disk with a daily backup', async () => {
    await hub.saveNow();
    const saved = JSON.parse(await readFile(join(dir, 'pebbles-hub.json'), 'utf8'));
    expect(Object.keys(saved.records).length).toBeGreaterThan(3000);
    expect((await readdir(join(dir, 'backups'))).length).toBe(1);
    const again = new Hub(dir);
    await again.load();
    expect(again.devices()).toHaveLength(1);
  });

  it('rejects revoked phones', async () => {
    hub.revoke('phone1');
    expect((await phoneSync(token, 0, [])).status).toBe(401);
  });
});
