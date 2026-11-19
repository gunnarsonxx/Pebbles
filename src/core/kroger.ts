// King Soopers prices through the Kroger Developer API (free account at developer.kroger.com).
import type { HttpFn } from './market';

const API = 'https://api.kroger.com/v1';

export interface KrogerLocation {
  id: string;
  name: string;
  address: string;
  chain: string;
}

export interface KrogerProduct {
  productId: string;
  description: string;
  brand: string;
  regular: number | null;
  promo: number | null;
  size: string;
}

function basic(id: string, secret: string): string {
  return 'Basic ' + btoa(`${id}:${secret}`);
}

export async function krogerToken(http: HttpFn, clientId: string, secret: string): Promise<string> {
  const res = await http(`${API}/connect/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: basic(clientId, secret), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials&scope=product.compact',
  });
  if (res.status !== 200) throw new Error(res.status === 401 ? 'Kroger didn’t accept that client ID and secret.' : `Kroger replied ${res.status}`);
  return JSON.parse(res.text).access_token as string;
}

async function get<T>(http: HttpFn, token: string, path: string): Promise<T> {
  const res = await http(API + path, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  if (res.status !== 200) throw new Error(`Kroger replied ${res.status}`);
  return JSON.parse(res.text) as T;
}

export async function krogerLocations(http: HttpFn, token: string, zip: string): Promise<KrogerLocation[]> {
  const r = await get<{ data: { locationId: string; name: string; chain: string; address?: { addressLine1?: string; city?: string } }[] }>(
    http,
    token,
    `/locations?filter.zipCode.near=${encodeURIComponent(zip)}&filter.limit=10`,
  );
  return (r.data ?? []).map((l) => ({ id: l.locationId, name: l.name, chain: l.chain, address: [l.address?.addressLine1, l.address?.city].filter(Boolean).join(', ') }));
}

interface KProduct {
  productId: string;
  description: string;
  brand?: string;
  items?: { price?: { regular?: number; promo?: number }; size?: string }[];
}

function score(term: string, p: KProduct): number {
  const words = term.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const d = p.description.toLowerCase();
  return words.filter((w) => d.includes(w)).length / Math.max(1, words.length);
}

/** Best-matching product with a price at the chosen store. Store brands win ties (usually cheapest). */
export async function krogerPrice(http: HttpFn, token: string, locationId: string, term: string): Promise<KrogerProduct | null> {
  const r = await get<{ data: KProduct[] }>(http, token, `/products?filter.term=${encodeURIComponent(term)}&filter.locationId=${encodeURIComponent(locationId)}&filter.limit=8`);
  const priced = (r.data ?? [])
    .map((p) => ({ p, item: p.items?.find((i) => i.price?.regular) }))
    .filter((x) => x.item);
  if (!priced.length) return null;
  priced.sort((a, b) => {
    const s = score(term, b.p) - score(term, a.p);
    if (Math.abs(s) > 0.01) return s;
    const ap = a.item!.price!.promo || a.item!.price!.regular!;
    const bp = b.item!.price!.promo || b.item!.price!.regular!;
    return ap - bp;
  });
  const best = priced[0];
  const promo = best.item!.price!.promo;
  return {
    productId: best.p.productId,
    description: best.p.description,
    brand: best.p.brand ?? '',
    regular: best.item!.price!.regular ?? null,
    promo: promo && promo > 0 && promo < (best.item!.price!.regular ?? Infinity) ? promo : null,
    size: best.item!.size ?? '',
  };
}
