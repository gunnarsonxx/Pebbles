import { useEffect, useState } from 'react';
import { CalendarDays, Compass, Gem, House, Moon, Receipt, Settings as SettingsIcon, ChevronLeft, Sun, TrendingUp } from 'lucide-react';
import { saveSettings } from '../data/actions';
import { useData, useSync } from '../data/useData';
import { PebbleLogo, ToastProvider } from './components';
import { HomeScreen } from './screens/Home';
import { PaycheckScreen } from './screens/Paycheck';
import { SpendingScreen } from './screens/Spending';
import { SavingsScreen } from './screens/Savings';
import { PlanScreen } from './screens/Plan';
import { GrowScreen } from './screens/Grow';
import { SettingsScreen } from './screens/Settings';
import { Onboarding } from './screens/Onboarding';
import { onBack, pairEvents } from '../platform/native';
import { useToast } from './components';
import { platformKind } from '../platform';

export type Tab = 'home' | 'paycheck' | 'spending' | 'savings' | 'grow' | 'plan' | 'settings';

const TABS: { id: Tab; label: string; icon: typeof House }[] = [
  { id: 'home', label: 'Home', icon: House },
  { id: 'paycheck', label: 'Paycheck', icon: CalendarDays },
  { id: 'spending', label: 'Spending', icon: Receipt },
  { id: 'savings', label: 'Savings', icon: Gem },
  { id: 'grow', label: 'Grow', icon: TrendingUp },
  { id: 'plan', label: 'Plan', icon: Compass },
];

const TITLES: Record<Tab, string> = {
  home: 'Pebbles',
  paycheck: 'Paycheck',
  spending: 'Spending',
  savings: 'Savings',
  grow: 'Retirement & FIRE',
  plan: 'Plan',
  settings: 'Settings',
};

export function App() {
  const data = useData();
  const sync = useSync();
  const [tab, setTab] = useState<Tab>(() => (localStorageGet('pebbles.tab') as Tab) || 'home');
  const [prevTab, setPrevTab] = useState<Tab>('home');

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
  }, [tab]);

  useEffect(
    () =>
      onBack(() => {
        if (document.querySelector('.scrim')) {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
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
    [tab, prevTab],
  );

  const go = (t: Tab) => {
    if (t === 'settings') setPrevTab(tab === 'settings' ? prevTab : tab);
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
      <div className="app">
        <nav className="sidebar" aria-label="Main">
          <div className="brand">
            <PebbleLogo size={34} /> Pebbles
          </div>
          {TABS.map((t) => (
            <button key={t.id} className={`side-link${tab === t.id ? ' active' : ''}`} onClick={() => go(t.id)}>
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
              <button className="icon-btn" onClick={() => setTab(prevTab)} aria-label="Back">
                <ChevronLeft />
              </button>
            )}
            {tab === 'home' && (
              <span className="hide-desktop" style={{ display: 'flex' }}>
                <PebbleLogo size={28} />
              </span>
            )}
            <div className="title">{TITLES[tab]}</div>
            <ThemeToggle theme={data.settings.theme} />
            <button className="icon-btn" title={sync.message || syncLabel} aria-label={syncLabel} onClick={() => go('settings')}>
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
            {tab === 'paycheck' && <PaycheckScreen data={data} />}
            {tab === 'spending' && <SpendingScreen data={data} openSettings={() => go('settings')} />}
            {tab === 'savings' && <SavingsScreen data={data} />}
            {tab === 'plan' && <PlanScreen data={data} go={go} />}
            {tab === 'grow' && <GrowScreen data={data} />}
            {tab === 'settings' && <SettingsScreen data={data} />}
          </main>
        </div>
        <nav className="tabbar" aria-label="Main">
          {TABS.map((t) => (
            <button key={t.id} className={`tab${tab === t.id ? ' active' : ''}`} onClick={() => go(t.id)} aria-current={tab === t.id ? 'page' : undefined}>
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
