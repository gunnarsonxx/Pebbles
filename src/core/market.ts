// Live price data. Fetching is done with an injected http() so the desktop hub (Node)
// and the phone (native HTTP) can both use it without CORS trouble.
//
// - Gas: EIA weekly Colorado regular gasoline (needs a free EIA API key), otherwise
//   BLS monthly U.S. city average gasoline (no key).
// - Food: BLS CPI-U "food at home" for the West region (year-over-year change) and BLS
//   average prices for everyday staples in the West.
import type { MarketData } from './types';

export type HttpFn = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ status: number; text: string }>;

export const BLS_URL = 'https://api.bls.gov/publicAPI/v2/timeseries/data/';

export const STAPLES: { id: string; item: string; unit: string }[] = [
  { id: 'APU0400708111', item: 'Eggs', unit: 'dozen' },
  { id: 'APU0400709112', item: 'Milk', unit: 'gallon' },
  { id: 'APU0400702111', item: 'Bread', unit: 'lb' },
  { id: 'APU0400703112', item: 'Ground beef', unit: 'lb' },
  { id: 'APU0400FF1101', item: 'Chicken breast', unit: 'lb' },
  { id: 'APU0400711211', item: 'Bananas', unit: 'lb' },
];
const FOOD_CPI = 'CUUR0400SAF11'; // CPI-U West, food at home
const GAS_US = 'APU000074714'; // U.S. city average, unleaded regular, per gallon

interface BlsSeries {
  seriesID: string;
  data: { year: string; period: string; value: string }[];
}

function blsMonth(d: { year: string; period: string }): string {
  return `${d.year}-${d.period.slice(1).padStart(2, '0')}`;
}

export async function fetchBls(http: HttpFn, ids: string[]): Promise<BlsSeries[]> {
  const year = new Date().getFullYear();
  const res = await http(BLS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ seriesid: ids, startyear: String(year - 2), endyear: String(year) }),
  });
  if (res.status !== 200) throw new Error(`BLS returned ${res.status}`);
  const json = JSON.parse(res.text);
  if (json.status !== 'REQUEST_SUCCEEDED') throw new Error(`BLS: ${(json.message ?? []).join(' ') || json.status}`);
  return (json.Results?.series ?? []) as BlsSeries[];
}

export async function fetchEiaColoradoGas(http: HttpFn, apiKey: string): Promise<{ price: number; previous: number | null; asOf: string }> {
  const url =
    `https://api.eia.gov/v2/petroleum/pri/gnd/data/?api_key=${encodeURIComponent(apiKey)}` +
    '&frequency=weekly&data[0]=value&facets[series][]=EMM_EPMR_PTE_SCO_DPG&sort[0][column]=period&sort[0][direction]=desc&offset=0&length=6';
  const res = await http(url);
  if (res.status !== 200) throw new Error(`EIA returned ${res.status}`);
  const rows = JSON.parse(res.text)?.response?.data as { period: string; value: string | number }[] | undefined;
  if (!rows?.length) throw new Error('EIA returned no data');
  return {
    price: Number(rows[0].value),
    previous: rows.length > 4 ? Number(rows[4].value) : rows.length > 1 ? Number(rows[1].value) : null,
    asOf: rows[0].period,
  };
}

export async function refreshMarket(http: HttpFn, eiaKey: string, prev: MarketData | null): Promise<MarketData> {
  const errors: string[] = [];
  const next: MarketData = {
    id: 'market',
    gas: prev?.gas ?? null,
    foodCpi: prev?.foodCpi ?? null,
    staples: prev?.staples ?? [],
    fetchedAt: Date.now(),
    manualGasPrice: prev?.manualGasPrice ?? null,
    errors,
  };

  let gasDone = false;
  if (eiaKey) {
    try {
      const g = await fetchEiaColoradoGas(http, eiaKey);
      next.gas = { price: g.price, previous: g.previous, asOf: g.asOf, region: 'Colorado avg', source: 'U.S. EIA weekly retail gasoline' };
      gasDone = true;
    } catch (e) {
      errors.push(`Gas (EIA): ${(e as Error).message}`);
    }
  }

  try {
    const series = await fetchBls(http, [FOOD_CPI, ...(gasDone ? [] : [GAS_US]), ...STAPLES.map((s) => s.id)]);
    const byId = new Map(series.map((s) => [s.seriesID, s.data.filter((d) => /^M(0[1-9]|1[0-2])$/.test(d.period))]));
    const cpi = byId.get(FOOD_CPI);
    if (cpi && cpi.length) {
      const latest = cpi[0];
      const yearAgo = cpi.find((d) => d.period === latest.period && Number(d.year) === Number(latest.year) - 1);
      const yoy = yearAgo ? (Number(latest.value) / Number(yearAgo.value) - 1) * 100 : 0;
      next.foodCpi = { index: Number(latest.value), yoyPct: Math.round(yoy * 10) / 10, asOf: blsMonth(latest), region: 'West', source: 'BLS CPI-U food at home' };
    }
    if (!gasDone) {
      const g = byId.get(GAS_US);
      if (g && g.length) {
        next.gas = {
          price: Number(g[0].value),
          previous: g[1] ? Number(g[1].value) : null,
          asOf: blsMonth(g[0]),
          region: 'U.S. avg',
          source: 'BLS average price (add a free EIA key for Colorado weekly prices)',
        };
      }
    }
    const staples = STAPLES.map((s) => {
      const d = byId.get(s.id);
      if (!d || !d.length) return null;
      return { item: s.item, unit: s.unit, price: Number(d[0].value), asOf: blsMonth(d[0]), previous: d[1] ? Number(d[1].value) : null };
    }).filter(Boolean) as MarketData['staples'];
    if (staples.length) next.staples = staples;
  } catch (e) {
    errors.push(`Prices (BLS): ${(e as Error).message}`);
  }
  return next;
}
