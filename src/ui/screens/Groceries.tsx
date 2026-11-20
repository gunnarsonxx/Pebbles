import { useState } from 'react';
import { Camera, RefreshCw, ShoppingBasket, Store, Tag } from 'lucide-react';
import type { AppData } from '../../data/useData';
import { Empty, Segmented, useToast } from '../components';
import { PantryView, ShoppingListView } from './Pantry';
import { GasView } from './Gas';
import { MealsView } from './Meals';
import { ReceiptSheet } from '../sheets/ReceiptSheet';
import { DEPT_LABEL, WANT_DEPTS, extrasOn, monthlyGroceryNeed, receiptItemsTotal, sameProduct } from '../../core/groceries';
import { fmtShort } from '../../core/dates';
import { round2, usd } from '../../core/money';
import { refreshStorePrices } from '../../data/groceryActions';
import { krogerStoresOf } from '../../core/defaults';
import type { Receipt } from '../../core/types';
import type { GoTo } from '../App';

export function GroceriesView({ data, openSettings }: { data: AppData; openSettings: () => void }) {
  const toast = useToast();
  const [scanning, setScanning] = useState(false);
  const [viewing, setViewing] = useState<Receipt | null>(null);
  const [pricing, setPricing] = useState(false);
  const [showMath, setShowMath] = useState(false);
  const g = data.groceries;
  const kroger = data.settings.integrations;
  const krogerStores = krogerStoresOf(kroger);
  const hasKroger = !!(kroger.krogerClientId && kroger.krogerSecret && krogerStores.length);
  // live store prices for an item: one per King Soopers you picked
  // King Soopers prices for the same product you buy (not just anything with the same short name)
  const livePrices = (key: string, desc?: string) => [...data.prices.values()].filter((p) => (p.id === key || p.id.endsWith(`|${key}`)) && (!desc || sameProduct(desc, p)));
  const priceOf = (p: { promo: number | null; regular: number | null }) => (p.promo ?? p.regular) as number;
  const taxRate = g?.taxRate ?? 0.0407;
  const need = monthlyGroceryNeed(g);

  // best place for your usual list: compare stores on the items priced at both
  const compare = (() => {
    if (!g) return null;
    const stores = new Map<string, { total: number; count: number }>();
    const rows = g.usual.map((u) => {
      const prices: Record<string, number> = {};
      for (const [st, v] of Object.entries(u.byStore)) prices[st] = v.last;
      for (const kp of livePrices(u.key, u.desc)) if (kp.promo ?? kp.regular) prices[kp.store] = Math.min(prices[kp.store] ?? Infinity, priceOf(kp));
      return { u, prices };
    });
    const names = [...new Set(rows.flatMap((r) => Object.keys(r.prices)))];
    if (names.length < 2) return null;
    const shared = rows.filter((r) => names.every((n) => r.prices[n] != null));
    if (shared.length < 2) return null;
    for (const n of names)
      stores.set(n, {
        total: round2(shared.reduce((s, r) => s + r.prices[n], 0)),
        count: shared.length,
      });
    const sorted = [...stores.entries()].sort((a, b) => a[1].total - b[1].total);
    return { sorted, count: shared.length };
  })();

  const deals = g ? g.usual.flatMap((u) => livePrices(u.key, u.desc).map((p) => ({ u, p }))).filter((x) => x.p.promo != null && x.p.regular != null && x.p.promo < x.p.regular) : [];

  // the receipt sheets sit outside the two layouts, so saving the first receipt doesn't reset them
  const sheets = (
    <>
      {scanning && <ReceiptSheet data={data} onClose={() => setScanning(false)} />}
      {viewing && <ReceiptSheet data={data} existing={viewing} onClose={() => setViewing(null)} />}
    </>
  );

  if (!data.receipts.length) {
    return (
      <>
        <div className="card">
          <Empty icon={<ShoppingBasket className="big" />} title="Snap your grocery receipts">
            Pebbles learns what you buy on a normal trip, notices the extras, figures out your real grocery budget with tax, and can check King Soopers prices for the things you buy most.
          </Empty>
          <div className="center">
            <button className="btn primary" onClick={() => setScanning(true)}>
              <Camera /> Add a Receipt
            </button>
          </div>
        </div>
        {sheets}
      </>
    );
  }

  return (
    <>
      <div>
        <div className="grid two">
          <div className="card">
            <div className="card-head">
              <div className="eyebrow">Your Groceries</div>
              <button className="btn primary small" onClick={() => setScanning(true)}>
                <Camera /> Add Receipt
              </button>
            </div>
            {g ? (
              <>
                <div className="big-number">{`${usd(data.essentials.groceriesMonthly, true)}/month`}</div>
                <div className="small ink2">{data.essentials.groceriesReason}. This is the grocery money in your paycheck plan.</div>
                <div className="divider" />
                <div className="row between small">
                  <span>Your average trip</span>
                  <span className="num strong">{usd(g.avgTrip)}</span>
                </div>
                <div className="row between small">
                  <span>Trips a month</span>
                  <span className="num strong">{g.tripsPerMonth.toFixed(1)}</span>
                </div>
                <div className="row between small">
                  <span>Extras per trip (snacks, drinks…)</span>
                  <span className="num strong">{usd(g.extrasPerTrip)}</span>
                </div>
                {g.usual.length > 0 && (
                  <div className="row between small" style={{ alignItems: 'flex-start', gap: 10 }}>
                    <span>
                      On almost every trip: <span className="ink2">{g.usual.slice(0, 5).map((u) => u.name).join(', ')}{g.usual.length > 5 ? '…' : ''}</span>
                    </span>
                    <span className="num strong">{usd(g.usualTrip * (1 + taxRate))}</span>
                  </div>
                )}
                {(g.trips < 4 || g.spanDays < 28) && (
                  <p className="tiny warn" style={{ margin: '8px 0 0' }}>
                    From {g.trips} receipt{g.trips === 1 ? '' : 's'} over {g.spanDays} days, so these are rough. They firm up after about a month of receipts.
                  </p>
                )}
                <button className="link-btn small mt-s" onClick={() => setShowMath(!showMath)}>
                  {showMath ? 'Hide the Math' : 'How These Are Figured'}
                </button>
                {showMath && (
                  <div className="coverage-math mt-s tiny ink2" style={{ gap: 6 }}>
                    <div>
                      <strong>Grocery budget:</strong> everything on your receipts from the last {Math.min(120, g.spanDays)} days that’s a need (not snacks, drinks, alcohol, nicotine or hot food), ÷ {g.spanDays} days × 30.4 days, plus {(taxRate * 100).toFixed(1)}% tax
                      {need != null ? ` = ${usd(need)} a month` : ''}. It’s never set below the USDA Thrifty plan for your household
                      {need != null && data.essentials.groceriesMonthly > need + 1 ? ` (${usd(data.essentials.groceriesMonthly, true)}), so that’s what’s used for now` : ''}. {need == null ? 'Until you have three receipts it uses the USDA plan.' : ''}
                    </div>
                    <div>
                      <strong>Average trip:</strong> the totals of your {g.trips} receipts ÷ {g.trips}.
                    </div>
                    <div>
                      <strong>Trips a month:</strong> {g.trips} trips ÷ {g.spanDays} days × 30.4.
                    </div>
                    <div>
                      <strong>Extras per trip:</strong> everything that isn’t on almost every trip, ÷ {g.trips} trips.
                    </div>
                    {g.usual.length > 0 && (
                      <div>
                        <strong>On almost every trip:</strong> items on {g.trips >= 3 ? 'at least 40% of your trips (or 3+ of them)' : 'both of your trips'}: {g.usual.map((u) => `${u.name} ${usd(u.avgPrice)} × ${Math.round(u.share * 100)}% of trips`).join(', ')}, plus tax. That’s just your regulars, not a whole trip.
                      </div>
                    )}
                    <div className="muted">Backlog receipts count from the oldest one, so if you skip trips in between, the monthly numbers come out low until newer receipts fill in.</div>
                  </div>
                )}
              </>
            ) : (
              <p className="small ink2">After a receipt or two, Pebbles shows what your groceries really cost a month.</p>
            )}
          </div>

          <div className="card">
            <div className="eyebrow" style={{ marginBottom: 8 }}>
              Where the Extras Go
            </div>
            {g && g.extrasByDept.length ? (
              <div className="list">
                {g.extrasByDept.slice(0, 6).map((x) => (
                  <div key={x.dept} className="row between small" style={{ padding: '6px 0' }}>
                    <span>
                      {DEPT_LABEL[x.dept]}
                      {WANT_DEPTS.includes(x.dept) && (
                        <span className="badge warn" style={{ marginLeft: 6 }}>
                          want
                        </span>
                      )}
                    </span>
                    <span className="num">{usd(x.perTrip)} / trip</span>
                  </div>
                ))}
                <p className="tiny muted mt">
                  Skipping the “want” extras would save about {usd(g.extrasByDept.filter((x) => WANT_DEPTS.includes(x.dept)).reduce((s, x) => s + x.perTrip, 0) * g.tripsPerMonth, true)} a month.
                </p>
              </div>
            ) : (
              <p className="small muted">Nothing extra yet. Nice.</p>
            )}
          </div>
        </div>

        <div className="card mt">
          <div className="card-head">
            <div>
              <div className="eyebrow">Prices on What You Buy</div>
              <div className="small muted">{hasKroger ? `Live prices from ${krogerStores.map((x) => x.name).join(' and ')}, plus what you paid elsewhere` : 'What you paid at each store'}</div>
            </div>
            {hasKroger ? (
              <button
                className="btn small"
                disabled={pricing}
                onClick={async () => {
                  setPricing(true);
                  const r = await refreshStorePrices(true);
                  setPricing(false);
                  toast(r.error ? r.error : `Checked ${r.updated} prices`);
                }}
              >
                <RefreshCw className={pricing ? 'spin' : ''} /> {pricing ? 'Checking…' : 'Check Prices'}
              </button>
            ) : (
              <button className="btn small" onClick={openSettings}>
                <Store /> Add King Soopers Prices
              </button>
            )}
          </div>
          {compare && (
            <div className="card tint" style={{ padding: 14, marginBottom: 12 }}>
              <div className="strong">
                Cheapest for your usual list: {compare.sorted[0][0]} ({usd(compare.sorted[0][1].total)} for {compare.count} items)
              </div>
              <div className="small ink2">
                {compare.sorted
                  .slice(1)
                  .map(([n, v]) => `${n} ${usd(v.total)} (+${usd(v.total - compare.sorted[0][1].total)})`)
                  .join(' · ')}
              </div>
            </div>
          )}
          {deals.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div className="row gap-s small strong" style={{ marginBottom: 4 }}>
                <Tag size={15} /> On sale this week at King Soopers
              </div>
              {deals.map(({ u, p }) => (
                <div key={p.id} className="row between small" style={{ padding: '4px 0' }}>
                  <span>
                    {u.name} <span className="muted">· {p.store}</span>
                  </span>
                  <span className="num">
                    <span className="good strong">{usd(p!.promo as number)}</span>{' '}
                    <span className="muted" style={{ textDecoration: 'line-through' }}>
                      {usd(p!.regular as number)}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
          <div className="list">
            {(g?.usual ?? []).slice(0, 20).map((u) => {
              const live = livePrices(u.key, u.desc).sort((a, b) => priceOf(a) - priceOf(b));
              const kp = live[0];
              const best = Object.entries(u.byStore).sort((a, b) => a[1].last - b[1].last)[0];
              return (
                <div key={u.key} className="list-item" style={{ alignItems: 'flex-start' }}>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="strong small">{u.name}</div>
                    <div className="tiny muted">
                      You paid {usd(u.lastPrice)} at {u.lastStore}
                      {best && best[0] !== u.lastStore ? ` · cheapest ${best[0]} ${usd(best[1].last)}` : ''}
                    </div>
                  </div>
                  {kp && (kp.promo ?? kp.regular) != null && (
                    <div style={{ textAlign: 'right' }}>
                      <div className={`num strong small${kp.promo != null ? ' good' : ''}`}>{usd((kp.promo ?? kp.regular) as number)}</div>
                      <div className="tiny muted">
                        {kp.promo != null ? 'sale · ' : ''}
                        {kp.store}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <p className="tiny muted mt">Walmart doesn’t share prices with apps, so its prices come from your own Walmart receipts.</p>
        </div>

        <div className="card mt">
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            Receipts
          </div>
          <div className="list">
            {data.receipts.slice(0, 20).map((r) => {
              const extras = extrasOn(r, g);
              return (
                <button key={r.id} className="list-item" onClick={() => setViewing(r)}>
                  <ShoppingBasket size={18} />
                  <div className="grow">
                    <div className="strong">
                      {r.store} · {fmtShort(r.date)}
                    </div>
                    <div className="tiny muted ellipsis">
                      {r.items.length} items
                      {extras.length
                        ? ` · extras: ${extras
                            .slice(0, 3)
                            .map((e) => e.name)
                            .join(', ')}${extras.length > 3 ? '…' : ''}`
                        : ''}
                    </div>
                  </div>
                  <div className="amount">{usd(r.total ?? receiptItemsTotal(r))}</div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      {sheets}
    </>
  );
}

type GView = 'list' | 'pantry' | 'meals' | 'trips' | 'gas';

/** Groceries and gas: what you have, what to buy, what it costs, and where. */
export function GroceriesScreen({ data, go, view, setView }: { data: AppData; go: GoTo; view?: string; setView: (v: string) => void }) {
  const v: GView = view === 'pantry' || view === 'meals' || view === 'trips' || view === 'gas' ? view : 'list';
  return (
    <div>
      <div className="subnav">
        <Segmented
          value={v}
          options={[
            { value: 'list', label: 'List' },
            { value: 'pantry', label: 'Pantry' },
            { value: 'meals', label: 'Meals' },
            { value: 'trips', label: 'Receipts' },
            { value: 'gas', label: 'Gas' },
          ]}
          onChange={setView}
        />
      </div>
      {v === 'list' && <ShoppingListView data={data} openPantry={() => setView('pantry')} openTrips={() => setView('trips')} />}
      {v === 'pantry' && <PantryView data={data} />}
      {v === 'meals' && <MealsView data={data} openPantry={() => setView('pantry')} />}
      {v === 'trips' && <GroceriesView data={data} openSettings={() => go('settings', 'connections')} />}
      {v === 'gas' && <GasView data={data} go={go} />}
    </div>
  );
}
