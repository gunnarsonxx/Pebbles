// Platform glue: desktop (Electron), Android (Capacitor) or a plain browser.
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import type { HttpFn } from '../core/market';
import type { SyncRequest, SyncResponse } from '../core/sync';

export interface PairingInfo {
  code: string;
  expiresAt: number;
  addresses: string[];
  port: number;
  hubName: string;
}

export interface DeviceInfo {
  id: string;
  name: string;
  pairedAt: number;
  lastSeen: number | null;
}

export interface DesktopInfo {
  hubId: string;
  hubName: string;
  port: number;
  addresses: string[];
  dataPath: string;
  version: string;
  startWithWindows: boolean;
  closeToTray: boolean;
}

export interface DesktopBridge {
  sync(req: SyncRequest): Promise<SyncResponse>;
  http(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<{ status: number; text: string }>;
  pairingStart(): Promise<PairingInfo>;
  pairingStop(): Promise<void>;
  devices(): Promise<DeviceInfo[]>;
  revoke(id: string): Promise<void>;
  info(): Promise<DesktopInfo>;
  setPrefs(p: { startWithWindows?: boolean; closeToTray?: boolean }): Promise<void>;
  openDataFolder(): Promise<void>;
  onRemoteChange(cb: () => void): () => void;
}

declare global {
  interface Window {
    pebblesDesktop?: DesktopBridge;
  }
}

export type PlatformKind = 'desktop' | 'android' | 'web';

export const desktop: DesktopBridge | undefined = typeof window !== 'undefined' ? window.pebblesDesktop : undefined;

export const platformKind: PlatformKind = desktop ? 'desktop' : Capacitor.isNativePlatform() ? 'android' : 'web';

/** Native HTTP serializes JSON bodies itself, so pass objects rather than strings. */
function nativeData(init: { headers?: Record<string, string>; body?: string }): unknown {
  const ct = Object.entries(init.headers ?? {}).find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? '';
  if (init.body && ct.includes('application/json')) {
    try {
      return JSON.parse(init.body);
    } catch {
      return init.body;
    }
  }
  return init.body;
}

export const http: HttpFn = async (url, init = {}) => {
  if (desktop) return desktop.http(url, init);
  if (platformKind === 'android') {
    const res = await CapacitorHttp.request({
      url,
      method: init.method ?? 'GET',
      headers: init.headers ?? {},
      data: nativeData(init),
      responseType: 'text',
      connectTimeout: 8000,
      readTimeout: 20000,
    });
    const text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    return { status: res.status, text };
  }
  const res = await fetch(url, { method: init.method ?? 'GET', headers: init.headers, body: init.body });
  return { status: res.status, text: await res.text() };
};

/** Short HTTP call with a timeout, used to reach the desktop hub on the LAN. */
export async function lanRequest(url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}, timeoutMs = 6000) {
  if (platformKind === 'android') {
    const res = await CapacitorHttp.request({
      url,
      method: init.method ?? 'GET',
      headers: init.headers ?? {},
      data: nativeData(init),
      responseType: 'text',
      connectTimeout: timeoutMs,
      readTimeout: timeoutMs * 3,
    });
    return { status: res.status, text: typeof res.data === 'string' ? res.data : JSON.stringify(res.data) };
  }
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: init.method ?? 'GET', headers: init.headers, body: init.body, signal: ctl.signal });
    return { status: res.status, text: await res.text() };
  } finally {
    clearTimeout(t);
  }
}

export function deviceName(): string {
  if (platformKind === 'desktop') return 'This computer';
  const ua = navigator.userAgent;
  const m = ua.match(/Android [\d.]+; ([^;)]+)/);
  if (m) return m[1].replace(/Build.*/, '').trim() || 'Android phone';
  return platformKind === 'android' ? 'Android phone' : 'Browser';
}
