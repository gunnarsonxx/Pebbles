// Android-only niceties: status bar colors, back button, and payday / bill reminders.
import { App as CapApp } from '@capacitor/app';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Browser } from '@capacitor/browser';
import { StatusBar, Style } from '@capacitor/status-bar';
import { platformKind } from './index';
import { store } from '../data/store';
import { computeData } from '../data/useData';
import { addDays, today } from '../core/dates';
import { billsDueBetween } from '../core/budget';
import { usd } from '../core/money';
import { syncClient } from '../data/syncClient';

/** Listeners for pairing results so the UI can show a message. */
export const pairEvents = new EventTarget();

async function handlePairLink(url: string | undefined) {
  if (url?.startsWith('pebbles://plaid')) {
    const { recoverPendingLinks } = await import('../data/bank');
    void Browser.close().catch(() => {});
    void recoverPendingLinks();
    return;
  }
  if (!url || !url.startsWith('pebbles://pair')) return;
  const q = new URL(url.replace('pebbles://', 'https://pebbles.local/')).searchParams;
  const addr = q.get('addr') ?? '';
  const code = q.get('code') ?? '';
  try {
    const link = await syncClient.pair(addr, code);
    pairEvents.dispatchEvent(new CustomEvent('paired', { detail: `Paired with ${link.hubName}` }));
  } catch (e) {
    pairEvents.dispatchEvent(new CustomEvent('paired', { detail: (e as Error).message }));
  }
}

type BackHandler = () => boolean;
const backHandlers: BackHandler[] = [];

/** Register a handler for the Android back button; return true when handled. */
export function onBack(h: BackHandler): () => void {
  backHandlers.push(h);
  return () => {
    const i = backHandlers.lastIndexOf(h);
    if (i >= 0) backHandlers.splice(i, 1);
  };
}

export async function setupNative() {
  if (platformKind !== 'android') return;
  try {
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light });
    await StatusBar.setBackgroundColor({ color: dark ? '#1B1A17' : '#F3EFE6' });
  } catch {
    /* older devices */
  }
  CapApp.addListener('appUrlOpen', ({ url }) => void handlePairLink(url));
  void CapApp.getLaunchUrl().then((r) => handlePairLink(r?.url));
  CapApp.addListener('backButton', () => {
    for (let i = backHandlers.length - 1; i >= 0; i--) if (backHandlers[i]()) return;
    void CapApp.minimizeApp();
  });
  let timer: ReturnType<typeof setTimeout> | null = null;
  store.subscribe(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void scheduleReminders(), 4000);
  });
  void scheduleReminders();
}

async function scheduleReminders() {
  try {
    const data = computeData(store.version, today());
    if (!data.settings.onboarded) return;
    const perm = await LocalNotifications.checkPermissions();
    if (perm.display !== 'granted') {
      if (!data.settings.notifications) return;
      const req = await LocalNotifications.requestPermissions();
      if (req.display !== 'granted') return;
    }
    const pending = await LocalNotifications.getPending();
    if (pending.notifications.length) await LocalNotifications.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
    if (!data.settings.notifications) return;
    const at = (d: string, hour: number) => {
      const [y, m, day] = d.split('-').map(Number);
      return new Date(y, m - 1, day, hour, 0, 0);
    };
    const now = Date.now();
    const list: { id: number; title: string; body: string; schedule: { at: Date } }[] = [];
    const payday = data.upcoming.period.payday;
    if (at(payday, 8).getTime() > now) {
      list.push({
        id: 1001,
        title: 'Payday 🌿',
        body: `About ${usd(data.upcoming.net)} should land today. Open Pebbles to split it into bills, essentials, savings and you.`,
        schedule: { at: at(payday, 8) },
      });
    }
    const dues = billsDueBetween(data.bills, today(), addDays(today(), 30)).filter((b) => !b.bill.autopay);
    dues.slice(0, 20).forEach((b, i) => {
      const remind = at(addDays(b.date, -2), 9);
      if (remind.getTime() > now)
        list.push({ id: 2000 + i, title: `${b.bill.name} is due in 2 days`, body: `${usd(b.amount)} on ${b.date.slice(5).replace('-', '/')}.`, schedule: { at: remind } });
    });
    if (list.length) await LocalNotifications.schedule({ notifications: list });
  } catch (e) {
    console.warn('reminders', e);
  }
}
