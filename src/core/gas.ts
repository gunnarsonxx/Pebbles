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

export function parseOverpass(text: string, from: Point): Station[] {
  const els = (JSON.parse(text)?.elements ?? []) as OsmEl[];
  const out: Station[] = [];
  for (const e of els) {
    const lat = e.lat ?? e.center?.lat;
    const lon = e.lon ?? e.center?.lon;
    if (lat == null || lon == null) continue;
    const t = e.tags ?? {};
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
  fuelOptions?: { fuelPrices?: { type: string; price?: { units?: string; nanos?: number }; updateTime?: string }[] };
}

const GRADE: Record<string, string> = { REGULAR_UNLEADED: 'Regular', MIDGRADE: 'Midgrade', PREMIUM: 'Premium', DIESEL: 'Diesel' };

export function parsePlaces(text: string, from: Point, grade = 'REGULAR_UNLEADED'): Station[] {
  const places = (JSON.parse(text)?.places ?? []) as GPlace[];
  return places
    .filter((p) => p.location)
    .map((p) => {
      const fp = p.fuelOptions?.fuelPrices?.find((x) => x.type === grade);
      const price = fp?.price ? Number(fp.price.units ?? 0) + (fp.price.nanos ?? 0) / 1e9 : null;
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
        live: price ? { perGallon: Math.round(price * 1000) / 1000, grade: GRADE[grade] ?? 'Regular', updated: fp?.updateTime ?? null } : null,
      };
    })
    .sort((a, b) => a.miles - b.miles);
}

export async function googleStations(http: HttpFn, key: string, p: Point, radiusMeters = 8000): Promise<Station[]> {
  const res = await http(PLACES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.shortFormattedAddress,places.location,places.fuelOptions',
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
  return parsePlaces(res.text, p);
}

// ---------------- your own prices ----------------

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** The most recent price you logged for a station (by id, or by name within a third of a mile). */
export function knownPrice(st: Station, prices: GasPrice[], asOf: ISODate, maxAgeDays = 10): GasPrice | null {
  const fresh = prices.filter((p) => diffDays(asOf, p.date) <= maxAgeDays).sort((a, b) => b.date.localeCompare(a.date));
  return (
    fresh.find((p) => p.stationId === st.id) ??
    fresh.find((p) => p.lat != null && p.lon != null && milesBetween(st, { lat: p.lat, lon: p.lon }) < 0.3 && (norm(st.name).includes(norm(p.station)) || norm(p.station).includes(norm(st.brand ?? st.name)))) ??
    null
  );
}

export interface PricedStation extends Station {
  price: number | null;
  priceSource: 'google' | 'receipt' | 'manual' | null;
  priceDate: string | null;
}

export function priceStations(stations: Station[], prices: GasPrice[], asOf: ISODate): PricedStation[] {
  return stations.map((s) => {
    if (s.live) return { ...s, price: s.live.perGallon, priceSource: 'google', priceDate: s.live.updated?.slice(0, 10) ?? null };
    const k = knownPrice(s, prices, asOf);
    return { ...s, price: k?.perGallon ?? null, priceSource: k?.source ?? null, priceDate: k?.date ?? null };
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
