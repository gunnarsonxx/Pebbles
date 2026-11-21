// Sync protocol shared by the phone, the desktop window and the desktop hub.
//
// Each record carries updatedAt + deviceId. Merging is last-writer-wins per record,
// which is simple and predictable for a single person using two devices.
// Phone <-> hub traffic is encrypted with AES-256-GCM using a key derived from the
// device token created during pairing, so nothing readable crosses the network.
import type { SyncRecord } from './types';

export function newer(a: SyncRecord | undefined, b: SyncRecord): boolean {
  // true when b should replace a
  if (!a) return true;
  if (b.updatedAt !== a.updatedAt) return b.updatedAt > a.updatedAt;
  return b.deviceId > a.deviceId;
}

export interface SyncRequest {
  deviceId: string;
  since: number; // hub sequence the client has seen
  changes: SyncRecord[];
}

export interface SyncResponse {
  hubId: string;
  seq: number;
  changes: SyncRecord[];
  serverTime: number;
}

// ---------------- crypto ----------------

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function keyFromToken(token: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', enc.encode(token), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode('pebbles-sync-v1'), info: enc.encode('payload') }, material, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
}

export interface Sealed {
  v: 1;
  iv: string;
  data: string;
}

export async function seal(token: string, payload: unknown): Promise<Sealed> {
  const key = await keyFromToken(token);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(payload))));
  return { v: 1, iv: b64(iv), data: b64(ct) };
}

export async function open<T>(token: string, sealed: Sealed): Promise<T> {
  const key = await keyFromToken(token);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(sealed.iv) as BufferSource }, key, unb64(sealed.data) as BufferSource);
  return JSON.parse(dec.decode(pt)) as T;
}

/** Public id for a token (sent in the clear so the hub knows which key to use). */
export async function tokenId(token: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode('id:' + token)));
  return Array.from(d.slice(0, 12), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomToken(bytes = 32): string {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------- pairing (ECDH, authenticated by the 6-digit code) ----------------
// The code never crosses the network. Each side proves it knows the code with an HMAC
// over its ECDH public key; the shared secret becomes the device token.

async function hmac(code: string, data: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode('pebbles-pair:' + code), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, data as BufferSource));
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export interface PairOffer {
  pub: string;
  mac: string;
}

export async function pairKeys(): Promise<{ keys: CryptoKeyPair; pubRaw: Uint8Array }> {
  const keys = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const pubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey));
  return { keys, pubRaw };
}

export async function makeOffer(code: string, pubRaw: Uint8Array, otherPub?: Uint8Array): Promise<PairOffer> {
  const data = otherPub ? concat(pubRaw, otherPub) : pubRaw;
  return { pub: b64(pubRaw), mac: b64(await hmac(code, data)) };
}

export async function verifyOffer(code: string, offer: PairOffer, otherPub?: Uint8Array): Promise<boolean> {
  const pub = unb64(offer.pub);
  const data = otherPub ? concat(pub, otherPub) : pub;
  return equalBytes(await hmac(code, data), unb64(offer.mac));
}

export async function deriveToken(privateKey: CryptoKey, otherPubB64: string): Promise<string> {
  const other = await crypto.subtle.importKey('raw', unb64(otherPubB64) as BufferSource, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: other }, privateKey, 256));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', concat(bits, enc.encode('pebbles-token-v1')) as BufferSource));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function fromB64(s: string): Uint8Array {
  return unb64(s);
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** 6-digit pairing code. */
export function pairingCode(): string {
  const a = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(a).padStart(6, '0');
}
