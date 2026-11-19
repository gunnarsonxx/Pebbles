// "Update Pebbles" for each platform.
import { registerPlugin } from '@capacitor/core';
import { desktop, http, platformKind } from './index';
import { findUpdate, parseReleases, RELEASES_API, RELEASES_PAGE, type ReleaseInfo } from '../core/updates';

export const CURRENT_BUILD = Number(typeof __PEBBLES_BUILD__ !== 'undefined' ? __PEBBLES_BUILD__ : '0') || 0;

interface PebblesUpdatePlugin {
  canInstall(): Promise<{ allowed: boolean }>;
  openInstallSettings(): Promise<void>;
  downloadAndInstall(opts: { url: string; sha256?: string }): Promise<void>;
}

const NativeUpdate = registerPlugin<PebblesUpdatePlugin>('PebblesUpdate');

export type UpdateState =
  | { status: 'idle' | 'checking' | 'none' }
  | { status: 'available'; release: ReleaseInfo }
  | { status: 'downloading'; release: ReleaseInfo }
  | { status: 'needs-permission'; release: ReleaseInfo }
  | { status: 'error'; message: string; release?: ReleaseInfo };

let state: UpdateState = { status: 'idle' };
const listeners = new Set<() => void>();
const set = (s: UpdateState) => {
  state = s;
  listeners.forEach((l) => l());
};
export const updateStore = {
  get: () => state,
  subscribe: (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export async function checkForUpdate(): Promise<UpdateState> {
  set({ status: 'checking' });
  try {
    const res = await http(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' } });
    if (res.status !== 200) throw new Error(`GitHub replied ${res.status}`);
    const release = findUpdate(parseReleases(JSON.parse(res.text)), CURRENT_BUILD, platformKind);
    set(release ? { status: 'available', release } : { status: 'none' });
  } catch (e) {
    set({ status: 'error', message: (e as Error).message });
  }
  return state;
}

export async function installUpdate(release: ReleaseInfo): Promise<void> {
  try {
    if (platformKind === 'android' && release.apk) {
      const { allowed } = await NativeUpdate.canInstall();
      if (!allowed) {
        set({ status: 'needs-permission', release });
        await NativeUpdate.openInstallSettings();
        return;
      }
      set({ status: 'downloading', release });
      await NativeUpdate.downloadAndInstall({ url: release.apk.url, sha256: release.apk.sha256 ?? undefined });
      set({ status: 'available', release });
      return;
    }
    if (platformKind === 'desktop' && desktop && release.exe) {
      set({ status: 'downloading', release });
      await desktop.installUpdate(release.exe.url, release.exe.sha256);
      return; // the app restarts
    }
    window.open(release.pageUrl || RELEASES_PAGE, '_blank');
  } catch (e) {
    set({ status: 'error', message: (e as Error).message, release });
  }
}
