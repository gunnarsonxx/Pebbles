import { describe, expect, it } from 'vitest';
import { WHATS_NEW, markWhatsNewSeen, unseenWhatsNew } from './whatsnew';

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe('whats new', () => {
  it('shows the newest entry once after an update, then not again', () => {
    const s = mem();
    expect(unseenWhatsNew(s, false)?.id).toBe(WHATS_NEW[0].id);
    markWhatsNewSeen(s);
    expect(unseenWhatsNew(s, false)).toBeNull();
  });
  it('a fresh install starts caught up', () => {
    const s = mem();
    expect(unseenWhatsNew(s, true)).toBeNull();
    expect(unseenWhatsNew(s, false)).toBeNull();
  });
});
