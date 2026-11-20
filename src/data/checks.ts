// "Is it working?" checks for each outside service Pebbles uses.
import { store } from './store';
import { getSettings } from './actions';
import { http } from '../platform';
import { plaidCreds } from './bank';
import { createHostedLink } from '../core/plaid';
import { krogerPrice, krogerToken } from '../core/kroger';
import { fetchBls, fetchEiaGas } from '../core/market';
import { gasSeries } from '../core/regions';
import { BUILTIN_EIA_KEY, krogerStoresOf } from '../core/defaults';
import { RELEASES_API } from '../core/updates';
import { googleStations, placesFuelSummary } from '../core/gas';
import { googleMessage, useGoogleLookup } from './pantryActions';

export type CheckId = 'plaid' | 'kroger' | 'eia' | 'bls' | 'google' | 'github';

export interface CheckResult {
  id: CheckId;
  ok: boolean | null; // null = not set up
  msg: string;
  at: number;
}

export const CHECK_LABELS: Record<CheckId, string> = {
  plaid: 'Plaid (Bank Connections)',
  kroger: 'Kroger (King Soopers Prices)',
  eia: 'EIA (Gas Prices)',
  bls: 'BLS (Grocery Price Trends)',
  google: 'Google Maps (Gas Station Prices)',
  github: 'Pebbles Updates & Tax Tables',
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
        const key = s.eiaApiKey.trim() || BUILTIN_EIA_KEY;
        if (!key) return done(null, 'Not set up yet: add your free EIA key');
        const area = gasSeries(getSettings().stateTax.state);
        const g = await fetchEiaGas(http, key, area.series);
        return done(true, `${area.label.replace(' Average', '')} regular $${g.price.toFixed(2)}/gal (week of ${g.asOf})`);
      }
      case 'bls': {
        const series = await fetchBls(http, ['CUUR0400SAF11']);
        const d = series[0]?.data?.[0];
        return done(true, d ? `Food-at-home index ${d.value} (${d.periodName ?? d.period} ${d.year})` : 'Connected');
      }
      case 'google': {
        const key = s.googlePlacesKey.trim();
        if (!key) return done(null, 'Optional · not set up');
        const at = s.homeLat != null && s.homeLon != null ? { lat: s.homeLat, lon: s.homeLon } : { lat: 38.8339, lon: -104.8214 };
        const blocked = await useGoogleLookup();
        if (blocked) return done(true, 'Key saved · test skipped to stay in the free tier');
        const raw = { text: '' };
        const st = await googleStations(http, key, at, 8000, raw).catch((e) => {
          throw new Error(googleMessage((e as Error).message));
        });
        const f = placesFuelSummary(raw.text);
        if (f.withPrices) return done(true, `Key accepted · ${st.length} stations, ${f.withPrices} with posted prices`);
        if (f.withFuelInfo) return done(false, `Key accepted · ${st.length} stations · Google sent fuel info for ${f.withFuelInfo} but no prices (types: ${f.types.join(', ') || 'none'})`);
        return done(false, `Key accepted · ${st.length} stations, but Google sent no fuel price data for any of them. Google doesn’t share prices for your area through its API.`);
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
