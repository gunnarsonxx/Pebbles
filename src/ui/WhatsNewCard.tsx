import { useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { markWhatsNewSeen, unseenWhatsNew } from '../core/whatsnew';
import { fmtShort } from '../core/dates';
import { COMMUNITY } from '../core/edition';

const store = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

/** Community build, once after an update: what changed in this build. Close it and it's gone until the next one. */
export function WhatsNewCard({ fresh }: { fresh: boolean }) {
  // Community build only; the personal build gets its patch notes in chat
  const [entry, setEntry] = useState(() => (COMMUNITY ? unseenWhatsNew(store(), fresh) : null));
  if (!entry) return null;
  const close = () => {
    markWhatsNewSeen(store());
    setEntry(null);
  };
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <Sparkles size={20} style={{ color: 'var(--moss)', flexShrink: 0, marginTop: 2 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="eyebrow">What’s New · {fmtShort(entry.date)}</div>
          <h3 style={{ margin: '4px 0 8px' }}>{entry.title}</h3>
          <ul className="small ink2" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>
            {entry.items.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          <button className="btn small ghost" style={{ marginTop: 10 }} onClick={close}>
            Got It
          </button>
        </div>
        <button className="icon-btn" aria-label="Close" onClick={close}>
          <X size={18} />
        </button>
      </div>
    </div>
  );
}
