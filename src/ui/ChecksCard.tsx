import { useEffect, useState, useSyncExternalStore } from 'react';
import { CircleCheck, CircleDashed, CircleX, PlugZap, RefreshCw } from 'lucide-react';
import { CHECK_LABELS, checkStore, loadChecks, runAllChecks, runCheck, type CheckId } from '../data/checks';

/** Settings: a ✓ or ✗ for every outside service, so you know your keys work. */
export function ChecksCard() {
  const results = useSyncExternalStore(checkStore.subscribe, checkStore.get);
  const [busy, setBusy] = useState<CheckId | 'all' | null>(null);
  useEffect(() => {
    void loadChecks().then(() => {
      const stale = Object.values(checkStore.get()).every((r) => !r || Date.now() - r.at > 24 * 3600_000);
      if (stale) void runAllChecks();
    });
  }, []);
  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 10 }}>
        <PlugZap />
        <h2 className="grow">Connections</h2>
        <button
          className="btn small"
          disabled={busy != null}
          onClick={async () => {
            setBusy('all');
            await runAllChecks();
            setBusy(null);
          }}
        >
          <RefreshCw className={busy === 'all' ? 'spin' : ''} /> {busy === 'all' ? 'Testing…' : 'Test All'}
        </button>
      </div>
      <div className="list">
        {(Object.keys(CHECK_LABELS) as CheckId[]).map((id) => {
          const r = results[id];
          const Icon = !r ? CircleDashed : r.ok === true ? CircleCheck : r.ok === null ? CircleDashed : CircleX;
          const cls = !r || r.ok === null ? 'muted' : r.ok ? 'status-ok' : 'status-bad';
          return (
            <div key={id} className="list-item" style={{ alignItems: 'flex-start' }}>
              <Icon size={20} className={cls} style={{ flexShrink: 0, marginTop: 2 }} aria-label={!r ? 'Not tested' : r.ok ? 'Working' : r.ok === null ? 'Not set up' : 'Not working'} />
              <div className="grow">
                <div className="strong">{CHECK_LABELS[id]}</div>
                <div className={`small ${r?.ok === false ? 'bad' : 'muted'}`}>
                  {busy === id || (busy === 'all' && !r) ? 'Testing…' : r ? r.msg : 'Not tested yet'}
                  {r && <span className="tiny muted"> · {new Date(r.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>}
                </div>
              </div>
              <button
                className="btn ghost small"
                disabled={busy != null}
                onClick={async () => {
                  setBusy(id);
                  await runCheck(id);
                  setBusy(null);
                }}
              >
                Test
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
