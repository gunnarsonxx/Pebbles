// Gas stations near you, and what they charge.
//
// Station locations come from OpenStreetMap (free, no key). Prices come from three places:
//   1. your own gas receipts (exact, for the stations you use),
//   2. prices you tap in when you drive past a sign,
//   3. optionally Google Maps, which shows live posted prices (needs your own Google key).
// Home address → map position uses the free U.S. Census geocoder.
import type { HttpFn } from './market';
import type { GasPrice, ISODate } from './types';
import { diffDays } from './dates';

export interface Station {
  id: string; // 'osm:node/123' or 'g:ChIJ…'
  name: string;
  brand: string | null;
  lat: number;
  lon: number;
  address: string | null;
  miles: number; // from the point you searched around
  live: { perGallon: number; grade: string; updated: string | null } | null; // Google posted price
}

export interface Point {
  lat: number;
  lon: number;
}

/** Straight-line distance in miles. */
export function milesBetween(a: Point, b: Point): number {
  const R = 3958.8;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const CENSUS_URL = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress';

export async function geocodeAddress(http: HttpFn, address: string): Promise<Point & { matched: string }> {
  const url = `${CENSUS_URL}?address=${encodeURIComponent(address)}&benchmark=Public_AR_Current&format=json`;
  const res = await http(url);
  if (res.status !== 200) throw new Error(`The address lookup replied ${res.status}`);
  const m = JSON.parse(res.text)?.result?.addressMatches?.[0];
  if (!m) throw new Error('Couldn’t find that address. Try the full street, city and ZIP.');
  return { lat: m.coordinates.y, lon: m.coordinates.x, matched: m.matchedAddress };
}

export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

export function overpassQuery(p: Point, radiusMeters = 8000): string {
  return `[out:json][timeout:20];(node["amenity"="fuel"](around:${radiusMeters},${p.lat},${p.lon});way["amenity"="fuel"](around:${radiusMeters},${p.lat},${p.lon}););out center tags;`;
}

interface OsmEl {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

// Places tagged as fuel that aren't somewhere to fill a car: propane refills, EV chargers, truck-only
// cardlocks, and stations that have closed.
const NOT_A_PUMP = /propane|amerigas|ferrellgas|suburban propane|blue rhino|u-?haul|\bcng\b|\blpg\b|tesla|supercharger|charging|\bev\b|chargepoint|electrify|cardlock|card lock|commercial fuel|fleet|bulk (fuel|plant)|car ?wash only|tire/i;

/** Does an OpenStreetMap fuel station actually sell gas (or diesel), and is it open? */
export function sellsGas(t: Record<string, string>): boolean {
  if (t.disused === 'yes' || t.abandoned === 'yes' || t['disused:amenity'] || t['abandoned:amenity'] || t['was:amenity']) return false;
  if (/^(closed|off)$/i.test(t.opening_hours ?? '')) return false;
  if (t.access === 'private' || t.access === 'no') return false;
  if (NOT_A_PUMP.test(`${t.name ?? ''} ${t.brand ?? ''} ${t.operator ?? ''}`)) return false;
  const fuel = Object.entries(t).filter(([k]) => k.startsWith('fuel:'));
  if (fuel.length) {
    const yes = (k: string) => t[k] === 'yes';
    const gas = Object.keys(t).some((k) => /^fuel:(octane_\d+|diesel|e10|e15|e85|gasoline|petrol|regular)/.test(k) && yes(k));
    const onlyOther = fuel.every(([k, v]) => v !== 'yes' || /^fuel:(lpg|cng|propane|electricity|adblue|hgv_diesel|biogas|h70|lh2)/.test(k));
    if (!gas && onlyOther) return false;
  }
  return true;
}

export function parseOverpass(text: string, from: Point): Station[] {
  const els = (JSON.parse(text)?.elements ?? []) as OsmEl[];
  const out: Station[] = [];
  for (const e of els) {
    const lat = e.lat ?? e.center?.lat;
    const lon = e.lon ?? e.center?.lon;
    if (lat == null || lon == null) continue;
    const t = e.tags ?? {};
    if (!sellsGas(t)) continue;
    const name = t.name || t.brand || t.operator || 'Gas station';
    const street = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
    out.push({
      id: `osm:${e.type}/${e.id}`,
      name,
      brand: t.brand ?? null,
      lat,
      lon,
      address: street || null,
      miles: Math.round(milesBetween(from, { lat, lon }) * 10) / 10,
      live: null,
    });
  }
  return out.sort((a, b) => a.miles - b.miles);
}

/** Public Overpass servers: if one is down, blocked or unreachable from your network, try the next. */
export const OVERPASS_SERVERS = [
  OVERPASS_URL,
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

// The servers ask apps to say who they are; generic library names get refused (HTTP 406).
const OSM_HEADERS = { 'User-Agent': 'PebblesBudget/1.0 (personal budgeting app)', Accept: 'application/json' };

export async function stationsNear(http: HttpFn, p: Point, radiusMeters = 8000): Promise<Station[]> {
  const q = encodeURIComponent(overpassQuery(p, radiusMeters));
  let lastErr = '';
  for (const server of OVERPASS_SERVERS) {
    try {
      const res = await http(`${server}?data=${q}`, { headers: OSM_HEADERS });
      if (res.status === 200 && res.text.trim().startsWith('{')) return parseOverpass(res.text, p);
      lastErr = `replied ${res.status}`;
    } catch (e) {
      lastErr = (e as Error).message;
    }
  }
  throw new Error(`Couldn’t reach the station map (${lastErr}). Check your connection and try again.`);
}

// ---------------- Google Maps (optional, live posted prices) ----------------

export const PLACES_URL = 'https://places.googleapis.com/v1/places:searchNearby';
/** SHA-1 of the certificate the Android app is signed with (for Google keys restricted to this app). */
export const PEBBLES_CERT_SHA1 = '5670154DF4373C66C568DFCB2B3DFD368C7265D9';

interface GPlace {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  shortFormattedAddress?: string;
  location?: { latitude: number; longitude: number };
  businessStatus?: string; // OPERATIONAL, CLOSED_TEMPORARILY, CLOSED_PERMANENTLY
  primaryType?: string;
  fuelOptions?: { fuelPrices?: { type: string; price?: { units?: string; nanos?: number }; updateTime?: string }[] };
}

const GRADE: Record<string, string> = { REGULAR_UNLEADED: 'Regular', MIDGRADE: 'Midgrade', PREMIUM: 'Premium', DIESEL: 'Diesel' };

const GASOLINE = ['REGULAR_UNLEADED', 'E10', 'E80', 'E85', 'SP91', 'SP91_E10', 'SP92', 'SP95', 'SP95_E10', 'SP98', 'SP99', 'SP100', 'MIDGRADE', 'PREMIUM'];

function priceOf(x: { price?: { units?: string; nanos?: number } }): number | null {
  if (!x.price) return null;
  const v = Number(x.price.units ?? 0) + (x.price.nanos ?? 0) / 1e9;
  return v > 0 ? v : null;
}

// Google files plenty of convenience stores and car washes under "gas station" too
const FUEL_BRANDS = /shell|conoco|phillips|sinclair|chevron|exxon|mobil|valero|maverik|loaf|kum ?& ?go|quik ?trip|\bqt\b|7-?eleven|circle k|murphy|costco|sam'?s|king soopers|kroger|safeway|walmart|love'?s|pilot|flying j|speedway|casey|bp\b|arco|texaco|cenex|holiday|7 ?11|diamond shamrock|alta|gas|fuel|petro/i;

/** Is this Google place open, and a place to fill a car? */
export function googleSellsGas(p: { businessStatus?: string; primaryType?: string; displayName?: { text: string }; fuelOptions?: unknown }): boolean {
  if (p.businessStatus && p.businessStatus !== 'OPERATIONAL') return false;
  const name = p.displayName?.text ?? '';
  if (NOT_A_PUMP.test(name)) return false;
  if (p.primaryType === 'gas_station' || p.fuelOptions) return true;
  // listed as something else (a store, a car wash) but also as a gas station: only if it's a known fuel brand
  return FUEL_BRANDS.test(name);
}

export function parsePlaces(text: string, from: Point, grade = 'REGULAR_UNLEADED'): Station[] {
  const places = (JSON.parse(text)?.places ?? []) as GPlace[];
  return places
    .filter((p) => p.location && googleSellsGas(p))
    .map((p) => {
      const prices = (p.fuelOptions?.fuelPrices ?? []).filter((x) => priceOf(x) != null);
      // regular if listed, otherwise the cheapest gasoline grade the station shows
      const fp = prices.find((x) => x.type === grade) ?? prices.filter((x) => GASOLINE.includes(x.type)).sort((a, b) => (priceOf(a) ?? 0) - (priceOf(b) ?? 0))[0];
      const price = fp ? priceOf(fp) : null;
      const lat = p.location!.latitude;
      const lon = p.location!.longitude;
      return {
        id: `g:${p.id}`,
        name: p.displayName?.text ?? 'Gas station',
        brand: null,
        lat,
        lon,
        address: p.shortFormattedAddress ?? p.formattedAddress ?? null,
        miles: Math.round(milesBetween(from, { lat, lon }) * 10) / 10,
        live: price && fp ? { perGallon: Math.round(price * 1000) / 1000, grade: GRADE[fp.type] ?? fp.type.replace(/_/g, ' ').toLowerCase(), updated: fp.updateTime ?? null } : null,
      };
    })
    .sort((a, b) => a.miles - b.miles);
}

/** What Google actually sent about fuel: for telling "no price data here" from "Pebbles misread it". */
export function placesFuelSummary(text: string): { places: number; withFuelInfo: number; withPrices: number; types: string[] } {
  const places = (JSON.parse(text)?.places ?? []) as GPlace[];
  const types = new Set<string>();
  let withFuelInfo = 0;
  let withPrices = 0;
  for (const p of places) {
    if (p.fuelOptions) withFuelInfo++;
    const fps = p.fuelOptions?.fuelPrices ?? [];
    if (fps.some((x) => priceOf(x) != null)) withPrices++;
    fps.forEach((x) => types.add(x.type));
  }
  return { places: places.length, withFuelInfo, withPrices, types: [...types] };
}

export async function googleStations(http: HttpFn, key: string, p: Point, radiusMeters = 8000, raw?: { text: string }): Promise<Station[]> {
  const res = await http(PLACES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      // businessStatus / primaryType sit in a lower price tier than fuelOptions, so they add nothing to the cost
      'X-Goog-FieldMask': 'places.id,places.displayName,places.shortFormattedAddress,places.location,places.fuelOptions,places.businessStatus,places.primaryType',
      // lets a key restricted to "Android apps" (package app.pebbles.money + this signing fingerprint) work
      'X-Android-Package': 'app.pebbles.money',
      'X-Android-Cert': PEBBLES_CERT_SHA1,
    },
    body: JSON.stringify({ includedTypes: ['gas_station'], maxResultCount: 20, rankPreference: 'DISTANCE', locationRestriction: { circle: { center: { latitude: p.lat, longitude: p.lon }, radius: radiusMeters } } }),
  });
  if (res.status !== 200) {
    let msg = `Google replied ${res.status}`;
    try {
      msg = JSON.parse(res.text)?.error?.message ?? msg;
    } catch {
      /* keep */
    }
    throw new Error(msg);
  }
  if (raw) raw.text = res.text;
  return parsePlaces(res.text, p);
}

// ---------------- your own prices ----------------

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function sameStation(st: Station, p: GasPrice): boolean {
  if (p.stationId && p.stationId === st.id) return true;
  return p.lat != null && p.lon != null && milesBetween(st, { lat: p.lat, lon: p.lon }) < 0.3 && (norm(st.name).includes(norm(p.station)) || norm(p.station).includes(norm(st.brand ?? st.name)));
}

/** The most recent price you logged for a station (by id, or by name within a third of a mile). */
export function knownPrice(st: Station, prices: GasPrice[], asOf: ISODate, maxAgeDays = 10): GasPrice | null {
  const fresh = prices.filter((p) => diffDays(asOf, p.date) <= maxAgeDays).sort((a, b) => b.date.localeCompare(a.date));
  return fresh.find((p) => sameStation(st, p)) ?? null;
}

// ---------------- estimates between real prices ----------------
// A station's price moves with the area, but its place relative to the average holds steady:
// warehouse clubs well under, big-box and grocery stations a bit under, name brands over.

const BRANDS: [RegExp, string, number][] = [
  [/costco/i, 'costco', -0.3],
  [/sam'?s club/i, 'sams', -0.25],
  [/murphy/i, 'murphy', -0.12],
  [/walmart/i, 'walmart', -0.12],
  [/king soopers|kroger/i, 'kroger', -0.08],
  [/safeway/i, 'safeway', -0.06],
  [/maverik/i, 'maverik', -0.04],
  [/loaf ?'?n'? ?jug/i, 'loafnjug', -0.03],
  [/quik ?trip|\bqt\b/i, 'quiktrip', -0.04],
  [/kum ?& ?go/i, 'kumandgo', -0.02],
  [/circle ?k/i, 'circlek', 0],
  [/7-?eleven/i, '7eleven', 0.02],
  [/conoco/i, 'conoco', 0.02],
  [/phillips ?66/i, 'phillips66', 0.03],
  [/sinclair/i, 'sinclair', 0.01],
  [/valero/i, 'valero', 0.02],
  [/shell/i, 'shell', 0.08],
  [/chevron/i, 'chevron', 0.1],
  [/exxon|mobil/i, 'exxon', 0.08],
  [/\bbp\b|amoco/i, 'bp', 0.06],
];

export function brandOf(name: string): { key: string; typical: number } | null {
  for (const [re, key, typical] of BRANDS) if (re.test(name)) return { key, typical };
  return null;
}

const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

/** How far this station usually sits from the area average: its own history, then its brand's, then typical. */
export function stationOffset(st: Station, prices: GasPrice[], asOf: ISODate): { offset: number; basis: 'station' | 'brand' | 'typical' } | null {
  const usable = prices.filter((p) => p.areaAvg != null && p.areaAvg > 0 && diffDays(asOf, p.date) <= 120);
  const own = usable.filter((p) => sameStation(st, p)).map((p) => p.perGallon - (p.areaAvg as number));
  if (own.length) return { offset: avg(own), basis: 'station' };
  const b = brandOf(`${st.brand ?? ''} ${st.name}`);
  if (b) {
    const same = usable.filter((p) => brandOf(p.station)?.key === b.key).map((p) => p.perGallon - (p.areaAvg as number));
    if (same.length) return { offset: avg(same), basis: 'brand' };
    return { offset: b.typical, basis: 'typical' };
  }
  return null;
}

export interface PricedStation extends Station {
  price: number | null;
  priceSource: 'google' | 'receipt' | 'manual' | 'screenshot' | 'estimate' | null;
  priceDate: string | null;
  estimateBasis?: 'station' | 'brand' | 'typical';
}

/** Prices for each station: Google, then a real price from the last 3 days, then an estimate from this week's average. */
export function priceStations(stations: Station[], prices: GasPrice[], asOf: ISODate, areaAvg: number | null = null): PricedStation[] {
  return stations.map((s) => {
    if (s.live) return { ...s, price: s.live.perGallon, priceSource: 'google', priceDate: s.live.updated?.slice(0, 10) ?? null };
    const recent = knownPrice(s, prices, asOf, 3);
    if (recent) return { ...s, price: recent.perGallon, priceSource: recent.source, priceDate: recent.date };
    if (areaAvg) {
      const o = stationOffset(s, prices, asOf);
      if (o) return { ...s, price: Math.round((areaAvg + o.offset) * 1000) / 1000, priceSource: 'estimate', priceDate: null, estimateBasis: o.basis };
    }
    const older = knownPrice(s, prices, asOf, 10);
    return { ...s, price: older?.perGallon ?? null, priceSource: older?.source ?? null, priceDate: older?.date ?? null };
  });
}

/** Is a farther, cheaper station worth the drive? (gas used getting there and back) */
export function worthTheDrive(cheap: PricedStation, near: PricedStation, gallons: number, mpg: number): number | null {
  if (cheap.price == null || near.price == null || mpg <= 0) return null;
  const extraMiles = Math.max(0, cheap.miles - near.miles) * 2;
  const saved = (near.price - cheap.price) * gallons;
  const cost = (extraMiles / mpg) * cheap.price;
  return Math.round((saved - cost) * 100) / 100;
}

// ---------------- prices from a Google Maps screenshot ----------------
// In Google Maps, searching "gas" shows a list of stations with prices. One screenshot of that
// list fills in every station Pebbles can match by name (and street number, when there are two of a brand).

const PRICE = /\$\s?(\d)[.,](\d{2,3})\b/;

function nameMatches(line: string, st: Station): boolean {
  const l = norm(line);
  const n = norm(st.name);
  if (n.length >= 4 && (l.includes(n) || (l.length >= 5 && n.includes(l)))) return true;
  const a = brandOf(line);
  const b = brandOf(`${st.brand ?? ''} ${st.name}`);
  return !!a && !!b && a.key === b.key;
}

export function pricesFromScreenshot(lines: string[], stations: Station[]): { station: Station; perGallon: number }[] {
  const out = new Map<string, { station: Station; perGallon: number }>();
  let current: Station | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const pm = line.match(PRICE);
    const textPart = line.replace(PRICE, '').trim();
    // a station name line (possibly with the price on the same line)
    if (/[A-Za-z]{3,}/.test(textPart)) {
      const cands = stations.filter((s) => nameMatches(textPart, s));
      if (cands.length) {
        // several of one brand: a street number on the line picks the right one, else the closest
        const num = textPart.match(/\b(\d{3,5})\b/)?.[1];
        current = (num && cands.find((s) => s.address?.includes(num))) || cands.sort((a, b) => a.miles - b.miles).find((s) => !out.has(s.id)) || cands[0];
      } else if (current) {
        const num = textPart.match(/^(\d{3,5})\s+\w/)?.[1];
        // an address line under a name: switch to the station at that address
        const byAddr = num ? stations.find((s) => s.address?.includes(num) && brandOf(s.name)?.key === brandOf(current!.name)?.key) : null;
        if (byAddr) current = byAddr;
      }
    }
    if (pm && current && !out.has(current.id)) {
      const v = Number(`${pm[1]}.${pm[2]}`);
      if (v > 1 && v < 9) out.set(current.id, { station: current, perGallon: v });
    }
  }
  return [...out.values()];
}
