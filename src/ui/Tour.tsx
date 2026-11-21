// A short, hands-on look around for new users: each step lights up a tab to tap, then explains what's there.
import { useEffect, useState } from 'react';
import { saveSettings } from '../data/actions';
import { COMMUNITY } from '../core/edition';
import { CalendarDays, Gem, House, PieChart, Settings, ShoppingBasket, Sprout, type LucideIcon } from 'lucide-react';
import { PebbleLogo } from './components';

type Tab = 'home' | 'paycheck' | 'budget' | 'groceries' | 'savings' | 'settings';

interface Step {
  tab: Tab | null; // the tab to tap; null = just read and press Next
  label?: string; // the tab's name on the bar
  title: string;
  body: string;
  sub?: string;
  icon?: LucideIcon; // the same icon the tab uses
  color?: string; // the app's color for that part of your money
}

const STEPS: Step[] = [
  {
    tab: null,
    title: 'A quick look around',
    body: 'About a minute, one pebble at a time. At each step, tap the glowing tab (or the button here), have a look, then press Next. Skip whenever you like.',
  },
  {
    tab: 'home',
    label: 'Home',
    icon: House,
    color: 'var(--moss)',
    title: 'Home: your next payday',
    body: 'What your next check should be, what to move where when it lands, and what’s coming up. Check here first.',
  },
  {
    tab: 'paycheck',
    label: 'Pay',
    icon: CalendarDays,
    color: 'var(--income)',
    title: 'Pay: your shifts and stubs',
    body: 'Paycheck shows what each check will be. Shifts is where you tap the days you work; every estimate updates from it. Upload pay stubs (several at once is fine) and Pebbles learns your real taxes and deductions.',
  },
  {
    tab: 'budget',
    label: 'Budget',
    icon: PieChart,
    color: 'var(--sapphire)',
    title: 'Budget: bills and spending',
    body: 'Add your bills once and Pebbles sets aside the right amount every check. Under Accounts, connect your bank or import a statement so spending tracks itself.',
  },
  {
    tab: 'groceries',
    label: 'Groceries',
    icon: ShoppingBasket,
    color: 'var(--citrine)',
    title: 'Groceries: receipts, kitchen, meals',
    body: 'Scan receipts to learn your real grocery and gas costs, keep track of what’s in your kitchen, and find recipes that use what you have.',
  },
  {
    tab: 'savings',
    label: 'Savings',
    icon: Gem,
    color: 'var(--jade)',
    title: 'Savings: your goals',
    body: 'Make goals and watch your pebble pile grow. Open any goal and use Reach It Sooner to put a little extra toward it each check.',
  },
  {
    tab: 'settings',
    icon: Settings,
    color: 'var(--amethyst)',
    sub: COMMUNITY ? 'connections' : undefined,
    title: COMMUNITY ? 'Settings: connect things (optional)' : 'Settings: make it yours',
    body: COMMUNITY
      ? 'The checklist at the top walks you through free keys for bank connections, gas prices and grocery prices. Everything works without them.'
      : 'Taxes, budget, connections, colors, syncing with your computer, and app updates all live here.',
  },
  {
    tab: null,
    title: 'You’re all set',
    icon: Sprout,
    color: 'var(--moss)',
    body: 'A good first pebble: tap your work days on the Pay tab, or upload a pay stub. Your pile grows from there. You can replay this tour from Settings → Updates & Backup.',
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

  const Icon = step.icon;
  return (
    <div className="tour-card" role="dialog" aria-label="Tour">
      <div className="steps" style={{ marginBottom: 12 }} aria-label={`Step ${i + 1} of ${STEPS.length}`}>
        {STEPS.map((_, k) => (
          <span key={k} className={k <= i ? 'on' : ''} />
        ))}
      </div>
      <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
        {Icon ? (
          <span className="list-icon" style={{ background: step.color, color: '#fff', flexShrink: 0 }}>
            <Icon />
          </span>
        ) : (
          <span style={{ flexShrink: 0 }}>
            <PebbleLogo size={40} />
          </span>
        )}
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row between" style={{ alignItems: 'baseline' }}>
            <span className="eyebrow">
              {i + 1} of {STEPS.length}
            </span>
            {!last && (
              <button className="tour-skip" onClick={finish}>
                Skip Tour
              </button>
            )}
          </div>
          <h3 className="tour-title">{step.title}</h3>
          <p className="small ink2" style={{ margin: '4px 0 0' }}>
            {step.body}
          </p>
        </div>
      </div>
      <div className="row between" style={{ marginTop: 14 }}>
        <button className="btn small" disabled={i === 0} onClick={() => setI(i - 1)}>
          Back
        </button>
        {last ? (
          <button className="btn primary small" onClick={finish}>
            Let’s Go
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
