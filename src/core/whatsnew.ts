// What changed, shown once on Home after an update. Newest first; bump `id` for each new entry.
export interface WhatsNewEntry {
  id: number;
  date: string; // 'YYYY-MM-DD'
  title: string;
  items: string[];
}

export const WHATS_NEW: WhatsNewEntry[] = [
  {
    id: 1,
    date: '2026-11-25',
    title: 'Fixes',
    items: [
      'A receipt line with no printed text could leave the whole app blank. It opens normally now.',
      'Last Paycheck’s Plan → What Actually Happened now finds money moved to your Bills account even if you haven’t picked it in Settings.',
      'Evening times no longer stamp tomorrow’s date on typed-in balances, receipts without a date, or backups (they were using UTC, which is tomorrow after 5pm in Colorado).',
      'Notes: a three-payday month suggests saving the part that usually goes to bills, not the whole check. Phone & Internet and insurance tips count only your share, per month.',
    ],
  },
];

const KEY = 'pebbles:whatsnew-seen';

/** The newest entry you haven't seen yet. A fresh install skips the history and starts from now. */
export function unseenWhatsNew(storage: Pick<Storage, 'getItem' | 'setItem'> | null, fresh: boolean): WhatsNewEntry | null {
  const latest = WHATS_NEW[0];
  if (!latest || !storage) return null;
  let seen: number | null = null;
  try {
    const v = storage.getItem(KEY);
    seen = v == null ? null : Number(v);
  } catch {
    return null;
  }
  if (seen == null && fresh) {
    markWhatsNewSeen(storage);
    return null;
  }
  return (seen ?? 0) < latest.id ? latest : null;
}

export function markWhatsNewSeen(storage: Pick<Storage, 'setItem'> | null): void {
  try {
    storage?.setItem(KEY, String(WHATS_NEW[0]?.id ?? 0));
  } catch {
    /* private mode: it just shows again */
  }
}
