// "Is it working?" checks for each outside service Pebbles uses.
import { store } from './store';
import { getSettings } from './actions';
import { http } from '../platform';
import { plaidCreds } from './bank';
import { createHostedLink } from '../core/plaid';
import { krogerPrice, krogerToken } from '../core/kroger';
import { fetchBls, fetchEiaColoradoGas } from '../core/market';
import { BUILTIN_EIA_KEY, krogerStoresOf } from '../core/defaults';
import { RELEASES_API } from '../core/updates';

export type CheckId = 'plaid' | 'kroger' | 'eia' | 'bls' | 'github';

export interface CheckResult {
  id: CheckId;
  ok: boolean | null; // null = not set up
  msg: string;
  at: number;
}

export const CHECK_LABELS: Record<CheckId, string> = {
  plaid: 'Plaid (bank connections)',
  kroger: 'Kroger (King Soopers prices)',
  eia: 'EIA (Colorado gas prices)',
  bls: 'BLS (grocery prices)',
  github: 'Pebbles updates & tax tables',
};

let results: Partial<Record<CheckId, CheckResult>> = {};
const listeners = new Set<() => void>();
export const checkStore = {
  get: () => results,
  subscribe: (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export async function loadChecks() {
  results = (await store.getMeta<typeof results>('apiChecks')) ?? {};
  listeners.forEach((l) => l());
}

async function save(r: CheckResult) {
  results = { ...results, [r.id]: r };
  listeners.forEach((l) => l());
  await store.setMeta('apiChecks', results);
}

async function attempt(id: CheckId): Promise<CheckResult> {
  const s = getSettings().integrations;
  const done = (ok: boolean | null, msg: string): CheckResult => ({ id, ok, msg, at: Date.now() });
  try {
    switch (id) {
      case 'plaid': {
        const creds = plaidCreds();
        if (!creds) return done(null, 'Not set up yet');
        await createHostedLink(http, creds, 'pebbles-check');
        const banks = store.list('links').length;
        return done(true, `Keys accepted (${creds.env === 'sandbox' ? 'sandbox' : 'real banks'}) · ${banks} bank${banks === 1 ? '' : 's'} connected`);
      }
      case 'kroger': {
        if (!s.krogerClientId || !s.krogerSecret) return done(null, 'Not set up yet');
        const token = await krogerToken(http, s.krogerClientId.trim(), s.krogerSecret.trim());
        const stores = krogerStoresOf(s);
        if (!stores.length) return done(true, 'Keys accepted · pick your store(s) below');
        const p = await krogerPrice(http, token, stores[0].id, 'milk');
        return done(true, `Keys accepted · ${stores.length} store${stores.length === 1 ? '' : 's'}${p?.regular ? ` · milk ${'$' + p.regular.toFixed(2)} at ${stores[0].name}` : ''}`);
      }
      case 'eia': {
        const g = await fetchEiaColoradoGas(http, s.eiaApiKey.trim() || BUILTIN_EIA_KEY);
        return done(true, `Colorado regular $${g.price.toFixed(2)}/gal (week of ${g.asOf})`);
      }
      case 'bls': {
        const series = await fetchBls(http, ['CUUR0400SAF11']);
        const d = series[0]?.data?.[0];
        return done(true, d ? `Food-at-home index ${d.value} (${d.periodName ?? d.period} ${d.year})` : 'Connected');
      }
      case 'github': {
        const res = await http(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' } });
        if (res.status !== 200) return done(false, `GitHub replied ${res.status}`);
        return done(true, 'Reachable');
      }
    }
  } catch (e) {
    return done(false, (e as Error).message || 'Failed');
  }
}

export async function runCheck(id: CheckId): Promise<CheckResult> {
  const r = await attempt(id);
  await save(r);
  return r;
}

export async function runAllChecks(): Promise<void> {
  await Promise.all((Object.keys(CHECK_LABELS) as CheckId[]).map((id) => runCheck(id)));
}
