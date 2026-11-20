// A short, hands-on look around for new users: each step lights up a tab to tap, then explains what's there.
import { useEffect, useState } from 'react';
import { saveSettings } from '../data/actions';
import { COMMUNITY } from '../core/edition';

type Tab = 'home' | 'paycheck' | 'budget' | 'groceries' | 'savings' | 'settings';

interface Step {
  tab: Tab | null; // the tab to tap; null = just read and press Next
  label?: string; // the tab's name on the bar
  title: string;
  body: string;
  sub?: string;
}

const STEPS: Step[] = [
  {
    tab: null,
    title: 'Welcome! A quick look around',
    body: 'This takes about a minute. At each step, tap the glowing tab (or the button here), have a look, then press Next. You can skip at any time.',
  },
  {
    tab: 'home',
    label: 'Home',
    title: 'Home: your next payday',
    body: 'What your next check should be, what to move where when it lands, and what’s coming up. Check here first.',
  },
  {
    tab: 'paycheck',
    label: 'Pay',
    title: 'Pay: your shifts and stubs',
    body: 'Tap days you work so Pebbles can estimate each check. Upload pay stubs (several at once is fine) and it learns your real taxes and deductions.',
  },
  {
    tab: 'budget',
    label: 'Budget',
    title: 'Budget: bills and spending',
    body: 'Add your bills once and Pebbles sets aside the right amount every check. Under Accounts, connect your bank or import a statement so spending tracks itself.',
  },
  {
    tab: 'groceries',
    label: 'Groceries',
    title: 'Groceries: receipts, kitchen, meals',
    body: 'Scan receipts to learn your real grocery and gas costs, keep track of what’s in your kitchen, and find recipes that use what you have.',
  },
  {
    tab: 'savings',
    label: 'Savings',
    title: 'Savings: your goals',
    body: 'Make goals and watch your pebble pile grow. Open any goal and use Reach It Sooner to put a little extra toward it each check.',
  },
  {
    tab: 'settings',
    sub: COMMUNITY ? 'connections' : undefined,
    title: COMMUNITY ? 'Settings: connect things (optional)' : 'Settings: make it yours',
    body: COMMUNITY
      ? 'The checklist at the top walks you through free keys for bank connections, gas prices and grocery prices. Everything works without them.'
      : 'Taxes, budget, connections, colors, syncing with your computer, and app updates all live here.',
  },
  {
    tab: null,
    title: 'You’re all set',
    body: 'Start by tapping your work days on the Pay tab, or uploading a pay stub. You can replay this tour from Settings → Updates & Backup.',
  },
];

export function Tour({ tab, go }: { tab: string; go: (t: Tab, sub?: string) => void }) {
  const [i, setI] = useState(0);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;
  const finish = () => void saveSettings((s) => ({ ...s, tourDone: true }));

  // light up the tab this step points at
  useEffect(() => {
    const els = step.label ? [...document.querySelectorAll<HTMLElement>('.tab, .side-link')].filter((b) => b.textContent?.trim() === step.label) : [];
    if (step.tab === 'settings') els.push(...document.querySelectorAll<HTMLElement>('[aria-label="Settings"]'));
    els.forEach((e) => e.classList.add('tour-target'));
    return () => els.forEach((e) => e.classList.remove('tour-target'));
  }, [step]);

  return (
    <div className="tour-card" role="dialog" aria-label="Tour">
      <div className="row between" style={{ marginBottom: 4 }}>
        <span className="tiny muted">
          {i + 1} of {STEPS.length}
        </span>
        {!last && (
          <button className="btn ghost small" onClick={finish}>
            Skip Tour
          </button>
        )}
      </div>
      <div className="strong">{step.title}</div>
      <p className="small ink2" style={{ margin: '4px 0 10px' }}>
        {step.body}
      </p>
      <div className="row between">
        <button className="btn small" disabled={i === 0} onClick={() => setI(i - 1)}>
          Back
        </button>
        {last ? (
          <button className="btn primary small" onClick={finish}>
            Done
          </button>
        ) : step.tab && tab !== step.tab ? (
          <button className="btn primary small" onClick={() => go(step.tab as Tab, step.sub)}>
            {step.tab === 'settings' ? 'Open Settings' : `Tap ${step.label}`}
          </button>
        ) : (
          <button className="btn primary small" onClick={() => setI(i + 1)}>
            Next
          </button>
        )}
      </div>
    </div>
  );
}
