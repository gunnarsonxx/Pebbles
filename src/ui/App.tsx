import { BillAmountPrompt } from './BillPrompt';
import { useEffect, useState } from 'react';
import { CalendarDays, Gem, House, Moon, PieChart, Settings as SettingsIcon, ShoppingBasket, ChevronLeft, Sun } from 'lucide-react';
import { saveSettings } from '../data/actions';
import { useData, useSync } from '../data/useData';
import { PebbleLogo, ToastProvider } from './components';
import { HomeScreen } from './screens/Home';
import { PaycheckScreen } from './screens/Paycheck';
import { BudgetScreen } from './screens/Budget';
import { SavingsScreen } from './screens/Savings';
import { GroceriesScreen } from './screens/Groceries';
import { SettingsScreen, SETTINGS_SECTIONS } from './screens/Settings';
import { Onboarding } from './screens/Onboarding';
import { onBack, pairEvents } from '../platform/native';
import { useToast } from './components';
import { platformKind } from '../platform';
import { UpdatePill } from './UpdateCard';

export type Tab = 'home' | 'paycheck' | 'budget' | 'groceries' | 'savings' | 'settings';
/** Older names still used by some buttons: where they lead now. */
type Alias = 'plan' | 'spending' | 'accounts' | 'grow';
export type GoTo = (t: Tab | Alias, sub?: string) => void;
const ALIASES: Record<Alias, [Tab, string]> = {
  plan: ['budget', 'plan'],
  spending: ['budget', 'spending'],
  accounts: ['budget', 'accounts'],
  grow: ['savings', 'retirement'],
};

const TABS: { id: Tab; label: string; icon: typeof House }[] = [
  { id: 'home', label: 'Home', icon: House },
  { id: 'paycheck', label: 'Pay', icon: CalendarDays },
  { id: 'budget', label: 'Budget', icon: PieChart },
  { id: 'groceries', label: 'Groceries', icon: ShoppingBasket },
  { id: 'savings', label: 'Savings', icon: Gem },
];

const TITLES: Record<Tab, string> = {
  home: 'Pebbles',
  paycheck: 'Paycheck',
  budget: 'Budget',
  groceries: 'Groceries',
  savings: 'Savings',
  settings: 'Settings',
};

const VALID_TABS = new Set<string>(['home', 'paycheck', 'budget', 'groceries', 'savings', 'settings']);

export function App() {
  const data = useData();
  const sync = useSync();
  const [tab, setTab] = useState<Tab>(() => {
    const t = localStorageGet('pebbles.tab');
    return t && VALID_TABS.has(t) && t !== 'settings' ? (t as Tab) : 'home';
  });
  const [prevTab, setPrevTab] = useState<Tab>('home');
  const [subs, setSubs] = useState<Partial<Record<Tab, string>>>({});
  const setSub = (t: Tab, v: string | undefined) => setSubs((s) => ({ ...s, [t]: v }));

  useEffect(() => {
    const t = data.settings.theme;
    const root = document.documentElement;
    if (t === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', t);
    root.setAttribute('data-palette', data.settings.palette || 'limestone');
    root.setAttribute('data-accent', data.settings.accent || 'moss');
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => root.setAttribute('data-mode', t === 'dark' || (t === 'auto' && mq.matches) ? 'dark' : 'light');
    apply();
    mq.addEventListener?.('change', apply);
    return () => mq.removeEventListener?.('change', apply);
  }, [data.settings.theme, data.settings.palette, data.settings.accent]);

  useEffect(() => {
    try {
      localStorage.setItem('pebbles.tab', tab);
    } catch {
      /* ignore */
    }
    window.scrollTo({ top: 0 });
    document.querySelector('.main')?.scrollTo({ top: 0 });
  }, [tab, subs.settings]);

  useEffect(
    () =>
      onBack(() => {
        if (document.querySelector('.scrim')) {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
          return true;
        }
        if (tab === 'settings' && subs.settings) {
          setSub('settings', undefined);
          return true;
        }
        if (tab === 'settings') {
          setTab(prevTab);
          return true;
        }
        if (tab !== 'home') {
          setTab('home');
          return true;
        }
        return false;
      }),
    [tab, prevTab, subs.settings],
  );

  const go: GoTo = (to, sub) => {
    const [t, s2] = to in ALIASES ? ALIASES[to as Alias] : [to as Tab, sub];
    if (t === 'settings') setPrevTab(tab === 'settings' ? prevTab : tab);
    setSub(t, sub ?? s2);
    setTab(t);
  };

  if (!data.settings.onboarded) {
    return (
      <ToastProvider>
        <Onboarding data={data} />
      </ToastProvider>
    );
  }

  const syncLabel =
    sync.status === 'ok'
      ? 'Synced'
      : sync.status === 'syncing'
        ? 'Syncing…'
        : sync.status === 'offline'
          ? 'Away from home Wi-Fi'
          : sync.status === 'unpaired'
            ? platformKind === 'web'
              ? 'Not synced'
              : 'Not paired'
            : sync.status === 'error'
              ? 'Sync problem'
              : 'Ready';

  return (
    <ToastProvider>
      <BillAmountPrompt data={data} />
      <div className="app">
        <nav className="sidebar" aria-label="Main">
          <div className="brand">
            <PebbleLogo size={34} /> Pebbles
          </div>
          {TABS.map((t) => (
            <button key={t.id} className={`side-link${tab === t.id ? ' active' : ''}`} onClick={() => go(t.id, subs[t.id])}>
              <t.icon /> {t.label}
            </button>
          ))}
          <div className="spacer" />
          <button className={`side-link${tab === 'settings' ? ' active' : ''}`} onClick={() => go('settings')}>
            <SettingsIcon /> Settings
          </button>
          <div className="row small muted" style={{ padding: '10px 12px' }} title={sync.message || syncLabel}>
            <span className={`sync-dot ${sync.status}`} /> {syncLabel}
          </div>
        </nav>
        <div className="main">
          <header className="topbar">
            {tab === 'settings' && (
              <button className="icon-btn" onClick={() => (subs.settings ? setSub('settings', undefined) : setTab(prevTab))} aria-label="Back">
                <ChevronLeft />
              </button>
            )}
            {tab === 'home' && (
              <span className="hide-desktop" style={{ display: 'flex' }}>
                <PebbleLogo size={28} />
              </span>
            )}
            <div className="title">{tab === 'settings' && subs.settings ? (SETTINGS_SECTIONS.find((x) => x.id === subs.settings)?.title ?? 'Settings') : TITLES[tab]}</div>
            <UpdatePill />
            <ThemeToggle theme={data.settings.theme} />
            <button className="icon-btn" title={sync.message || syncLabel} aria-label={syncLabel} onClick={() => go('settings', 'sync')}>
              <span className={`sync-dot ${sync.status}`} />
            </button>
            {tab !== 'settings' && (
              <button className="icon-btn" onClick={() => go('settings')} aria-label="Settings">
                <SettingsIcon />
              </button>
            )}
          </header>
          <PairListener />
          <main className="content">
            {tab === 'home' && <HomeScreen data={data} go={go} />}
            {tab === 'paycheck' && <PaycheckScreen data={data} go={go} />}
            {tab === 'budget' && <BudgetScreen data={data} go={go} view={subs.budget} setView={(v) => setSub('budget', v)} />}
            {tab === 'groceries' && <GroceriesScreen data={data} go={go} view={subs.groceries} setView={(v) => setSub('groceries', v)} />}
            {tab === 'savings' && <SavingsScreen data={data} go={go} view={subs.savings} setView={(v) => setSub('savings', v)} />}
            {tab === 'settings' && <SettingsScreen data={data} section={subs.settings} open={(v) => setSub('settings', v)} />}
          </main>
        </div>
        <nav className="tabbar" aria-label="Main">
          {TABS.map((t) => (
            <button key={t.id} className={`tab${tab === t.id ? ' active' : ''}`} onClick={() => go(t.id, subs[t.id])} aria-current={tab === t.id ? 'page' : undefined}>
              <t.icon />
              {t.label}
            </button>
          ))}
        </nav>
      </div>
    </ToastProvider>
  );
}

function localStorageGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}

function PairListener() {
  const toast = useToast();
  useEffect(() => {
    const fn = (e: Event) => toast((e as CustomEvent<string>).detail);
    pairEvents.addEventListener('paired', fn);
    return () => pairEvents.removeEventListener('paired', fn);
  }, [toast]);
  return null;
}

function isDark(theme: 'auto' | 'light' | 'dark'): boolean {
  if (theme === 'auto') return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  return theme === 'dark';
}

/** One tap switches between Limestone (light) and Basalt (dark). */
function ThemeToggle({ theme }: { theme: 'auto' | 'light' | 'dark' }) {
  const dark = isDark(theme);
  return (
    <button
      className="icon-btn"
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={dark ? 'Light mode' : 'Dark mode'}
      onClick={() => void saveSettings({ theme: dark ? 'light' : 'dark' })}
    >
      {dark ? <Sun /> : <Moon />}
    </button>
  );
}
