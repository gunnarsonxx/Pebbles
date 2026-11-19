import { useSyncExternalStore } from 'react';
import { Download, RefreshCw, Sparkles } from 'lucide-react';
import { checkForUpdate, CURRENT_BUILD, installUpdate, updateStore } from '../platform/updater';
import { platformKind } from '../platform';
import { fmtLong } from '../core/dates';

export function useUpdate() {
  return useSyncExternalStore(updateStore.subscribe, updateStore.get);
}

/** Settings → Updates */
export function UpdateCard() {
  const u = useUpdate();
  const release = 'release' in u ? u.release : undefined;
  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 10 }}>
        <Sparkles />
        <h2 className="grow">Updates</h2>
        <span className="small muted">Build {CURRENT_BUILD || 'dev'}</span>
      </div>
      {u.status === 'available' || u.status === 'downloading' || u.status === 'needs-permission' ? (
        <div className="col">
          <div className="strong">
            {release?.name} is ready{release?.publishedAt ? ` (${fmtLong(release.publishedAt.slice(0, 10))})` : ''}
          </div>
          {u.status === 'needs-permission' && (
            <p className="small ink2">Android asked you to allow Pebbles to install updates. Turn on “Allow from this source”, come back, and tap Update again.</p>
          )}
          <button className="btn primary" style={{ alignSelf: 'flex-start' }} disabled={u.status === 'downloading'} onClick={() => release && void installUpdate(release)}>
            <Download /> {u.status === 'downloading' ? 'Downloading…' : 'Update Pebbles'}
          </button>
          <p className="tiny muted">
            {platformKind === 'android'
              ? 'Downloads the new app and opens Android’s installer. Your data stays.'
              : platformKind === 'desktop'
                ? 'Downloads, checks and installs the new version, then reopens Pebbles. Your data stays.'
                : 'Opens the download page.'}
          </p>
        </div>
      ) : (
        <div className="col">
          <p className="small ink2">
            {u.status === 'none'
              ? 'You have the latest version.'
              : u.status === 'error'
                ? `Couldn’t check: ${u.message}`
                : 'Pebbles checks for new versions once a day.'}
          </p>
          <button className="btn small" style={{ alignSelf: 'flex-start' }} disabled={u.status === 'checking'} onClick={() => void checkForUpdate()}>
            <RefreshCw /> {u.status === 'checking' ? 'Checking…' : 'Check for Updates'}
          </button>
        </div>
      )}
    </div>
  );
}

/** A slim banner on Home when a new version is waiting. */
export function UpdateBanner() {
  const u = useUpdate();
  if (u.status !== 'available' && u.status !== 'downloading' && u.status !== 'needs-permission') return null;
  return (
    <div className="card tint row mt" style={{ padding: '12px 16px' }}>
      <Sparkles size={18} style={{ color: 'var(--amethyst)' }} />
      <div className="grow small">
        <strong>A new version of Pebbles is ready.</strong>
      </div>
      <button className="btn small primary" disabled={u.status === 'downloading'} onClick={() => void installUpdate(u.release)}>
        {u.status === 'downloading' ? 'Downloading…' : 'Update'}
      </button>
    </div>
  );
}
