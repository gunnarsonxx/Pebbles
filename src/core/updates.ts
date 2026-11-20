// Finding newer builds of Pebbles on the repository's Releases page. Each edition only installs its own files.
import { ASSET_APK, ASSET_EXE } from './edition';
export const REPO = 'gunnarsonxx/Pebbles';
export const RELEASES_API = `https://api.github.com/repos/${REPO}/releases?per_page=15`;
export const RELEASES_PAGE = `https://github.com/${REPO}/releases`;

export interface ReleaseAsset {
  url: string;
  sha256: string | null;
  size: number;
}

export interface ReleaseInfo {
  build: number;
  tag: string;
  name: string;
  publishedAt: string;
  prerelease: boolean;
  pageUrl: string;
  apk: ReleaseAsset | null;
  exe: ReleaseAsset | null;
}

interface GhAsset {
  name: string;
  browser_download_url: string;
  size: number;
  digest?: string | null;
  state?: string;
}

interface GhRelease {
  tag_name: string;
  name: string | null;
  published_at: string | null;
  prerelease: boolean;
  draft: boolean;
  html_url: string;
  assets: GhAsset[];
}

function asset(list: GhAsset[], name: string): ReleaseAsset | null {
  const a = list.find((x) => x.name === name && (x.state ?? 'uploaded') === 'uploaded');
  if (!a) return null;
  const sha = a.digest && a.digest.startsWith('sha256:') ? a.digest.slice(7) : null;
  return { url: a.browser_download_url, sha256: sha, size: a.size };
}

export function parseReleases(json: unknown, names: { apk: string; exe: string } = { apk: ASSET_APK, exe: ASSET_EXE }): ReleaseInfo[] {
  if (!Array.isArray(json)) return [];
  return (json as GhRelease[])
    .filter((r) => !r.draft && /^build-\d+$/.test(r.tag_name))
    .map((r) => ({
      build: Number(r.tag_name.slice(6)),
      tag: r.tag_name,
      name: r.name ?? r.tag_name,
      publishedAt: r.published_at ?? '',
      prerelease: r.prerelease,
      pageUrl: r.html_url,
      apk: asset(r.assets ?? [], names.apk),
      exe: asset(r.assets ?? [], names.exe),
    }))
    .sort((a, b) => b.build - a.build);
}

/** The newest release that has a download for this platform and is newer than `current`. */
export function findUpdate(releases: ReleaseInfo[], current: number, platform: 'android' | 'desktop' | 'web'): ReleaseInfo | null {
  for (const r of releases) {
    if (r.build <= current) return null;
    if (platform === 'android' && r.apk) return r;
    if (platform === 'desktop' && r.exe) return r;
    if (platform === 'web') return r;
  }
  return null;
}
