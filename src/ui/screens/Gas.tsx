import { useEffect, useState } from 'react';
import { Fuel, House, LocateFixed, MapPin, Pencil, RefreshCw } from 'lucide-react';
import type { AppData } from '../../data/useData';
import type { GoTo } from '../App';
import { Field, NumberInput, Segmented, Sheet, TextInput, useToast } from '../components';
import { currentGasPrice } from '../../core/food';
import { priceStations, worthTheDrive, type PricedStation, type Station, type Point } from '../../core/gas';
import { fmtShort } from '../../core/dates';
import { usd } from '../../core/money';
import { currentPosition, loadStations, logGasPrice, setHomeAddress, type StationCache } from '../../data/pantryActions';

const friendly = (e: unknown) => {
  const m = (e as Error)?.message ?? '';
  return /fetch|network|timed? ?out|load failed/i.test(m) ? 'Couldn’t reach the map service. Check your internet connection and try again.' : m || 'Something went wrong.';
};

const ppg = (v: number) => `$${v.toFixed(3).replace(/0$/, '')}`;

export function GasView({ data, go }: { data: AppData; go: GoTo }) {
  const toast = useToast();
  const i = data.settings.integrations;
  const hasHome = i.homeLat != null && i.homeLon != null;
  const [where, setWhere] = useState<'home' | 'here'>('home');
  const [cache, setCache] = useState<StationCache | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [address, setAddress] = useState(i.homeAddress);
  const [editHome, setEditHome] = useState(!hasHome);
  const [pricing, setPricing] = useState<Station | null>(null);

  const load = async (force = false) => {
    setErr('');
    setBusy(true);
    try {
      let point: Point;
      if (where === 'home') {
        if (i.homeLat == null || i.homeLon == null) return;
        point = { lat: i.homeLat, lon: i.homeLon };
      } else point = await currentPosition();
      const started = Date.now();
      const res = await loadStations(where, point, force);
      // let the refresh be seen even when the answer comes from the saved copy
      if (force) await new Promise((r) => setTimeout(r, Math.max(0, 700 - (Date.now() - started))));
      setCache(res);
      if (force) {
        const withPrice = priceStations(res.stations, data.gasPrices, data.today).filter((x) => x.price != null).length;
        toast(res.googleError ? 'Couldn’t get live prices. See the note below.' : res.note ? 'Showing the latest prices' : `Updated · ${res.stations.length} stations, ${withPrice} with prices`);
      }
    } catch (e) {
      setErr(friendly(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    setCache(null);
    if (where === 'home' ? hasHome : false) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [where, i.homeLat, i.homeLon]);

  const stations: PricedStation[] = cache ? priceStations(cache.stations, data.gasPrices, data.today) : [];
  const priced = stations.filter((s) => s.price != null).sort((a, b) => (a.price as number) - (b.price as number));
  const nearest = stations[0] ?? null;
  const cheapest = priced[0] ?? null;
  const tank = 12;
  const mpg = data.settings.household.vehicleMpg ?? 25;
  const gain = cheapest && nearest && cheapest.id !== nearest.id && nearest.price != null ? worthTheDrive(cheapest, nearest, tank, mpg) : null;
  const avg = currentGasPrice(data.market);
  const lastPaid = data.gasPrices.find((g) => g.source !== 'google');

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="card">
        <div className="grid two" style={{ gap: 12 }}>
          <div>
            <div className="eyebrow">You Last Paid</div>
            <div className="big-number">{lastPaid ? ppg(lastPaid.perGallon) : '—'}</div>
            <div className="tiny muted">{lastPaid ? `${lastPaid.station} · ${fmtShort(lastPaid.date)}` : 'Upload a gas receipt or tap a price below'}</div>
          </div>
          <div>
            <div className="eyebrow">Colorado Average</div>
            <div className="big-number">{data.market?.gas ? ppg(data.market.gas.price) : avg ? ppg(avg.price) : '—'}</div>
            <div className="tiny muted">{data.market?.gas ? `Regular, week of ${fmtShort(data.market.gas.asOf)}` : 'Loads when you’re online'}</div>
          </div>
        </div>
        <div className="divider" />
        <div className="row between small">
          <span className="ink2">Gas in your budget</span>
          <span className="strong num">{usd(data.essentials.gasMonthly, true)}/month</span>
        </div>
        <div className="tiny muted">{data.essentials.gasReason}</div>
      </div>

      <Segmented
        value={where}
        options={[
          { value: 'home', label: 'Near Home' },
          { value: 'here', label: 'Near Me Now' },
        ]}
        onChange={setWhere}
      />

      {where === 'home' && (editHome || !hasHome) && (
        <div className="card">
          <Field label="Your Home Address" hint="Used only to find stations near home. The U.S. Census map service turns it into a map position.">
            <TextInput value={address} onChange={setAddress} placeholder="Street, city, ZIP" />
          </Field>
          <div className="row mt">
            <button
              className="btn primary"
              disabled={!address.trim() || busy}
              onClick={async () => {
                setBusy(true);
                setErr('');
                try {
                  const m = await setHomeAddress(address);
                  toast(`Found ${m}`);
                  setEditHome(false);
                } catch (e) {
                  setErr(friendly(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <House /> {busy ? 'Finding…' : 'Save Home'}
            </button>
            {hasHome && (
              <button className="btn" onClick={() => setEditHome(false)}>
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

      {where === 'here' && !cache && (
        <div className="card center">
          <p className="small ink2" style={{ marginTop: 0 }}>
            See the stations around wherever you are right now.
          </p>
          <button className="btn primary" disabled={busy} onClick={() => void load()}>
            <LocateFixed /> {busy ? 'Finding You…' : 'Use My Location'}
          </button>
        </div>
      )}

      {err && <div className="badge bad" style={{ whiteSpace: 'normal' }}>{err}</div>}

      {cache && (
        <div className="card">
          <div className="card-head">
            <div>
              <div className="eyebrow">{where === 'home' ? 'Stations Near Home' : 'Stations Near You'}</div>
              <div className="tiny muted">
                {stations.length} within 5 miles · {cache.source === 'google' ? 'live prices from Google Maps' : 'prices from your receipts and taps'}
              </div>
              <div className="tiny muted">{busy ? 'Refreshing…' : `Updated ${new Date(cache.googleAt ?? cache.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`}</div>
            </div>
            <div className="row gap-s">
              {where === 'home' && (
                <button className="icon-btn" onClick={() => setEditHome(true)} aria-label="Change home address">
                  <Pencil size={16} />
                </button>
              )}
              <button className={`icon-btn${busy ? ' spinning' : ''}`} disabled={busy} onClick={() => void load(true)} aria-label="Refresh stations">
                <RefreshCw size={16} />
              </button>
            </div>
          </div>
          {cache.googleError && (
            <div className="card tint" style={{ padding: 12, marginBottom: 10, borderLeft: '4px solid var(--warn)' }}>
              <div className="strong small">Live Prices Didn’t Load</div>
              <div className="tiny ink2">{cache.googleError}</div>
            </div>
          )}
          {cache.note && <div className="tiny muted" style={{ marginBottom: 8 }}>{cache.note}</div>}
          {cheapest && (
            <div className="card tint" style={{ padding: 12, marginBottom: 10 }}>
              <div className="strong small">
                Cheapest known: {cheapest.name} {ppg(cheapest.price as number)} · {cheapest.miles} mi
              </div>
              {gain != null && (
                <div className="tiny ink2">
                  {gain > 0.5
                    ? `Worth the drive: about ${usd(gain)} less on a ${tank}-gallon fill-up than ${nearest!.name}, after the gas to get there.`
                    : `Not worth a detour from ${nearest!.name}: the drive costs about what you’d save.`}
                </div>
              )}
            </div>
          )}
          <div className={`list${busy ? ' refreshing' : ''}`}>
            {stations.slice(0, 15).map((s) => (
              <div key={s.id} className="list-item">
                <MapPin size={18} className="muted" style={{ flexShrink: 0 }} />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="strong small ellipsis">{s.name}</div>
                  <div className="tiny muted ellipsis">
                    {s.miles} mi{s.address ? ` · ${s.address}` : ''}
                    {s.priceDate ? ` · ${s.priceSource === 'receipt' ? 'your receipt' : s.priceSource === 'manual' ? 'you logged' : 'posted'} ${fmtShort(s.priceDate)}` : ''}
                  </div>
                </div>
                {s.price != null ? (
                  <button className="btn ghost small num" onClick={() => setPricing(s)}>
                    {ppg(s.price)}
                  </button>
                ) : (
                  <button className="btn small" onClick={() => setPricing(s)}>
                    <Fuel /> Price
                  </button>
                )}
              </div>
            ))}
          </div>
          {!stations.length && <p className="small muted">No stations found nearby.</p>}
          {cache.source !== 'google' && !i.googlePlacesKey && (
            <p className="tiny muted mt">
              Station prices aren’t public for free. Pebbles uses your gas receipts and the prices you tap in. For live posted prices,{' '}
              <button className="link-btn" onClick={() => go('settings', 'connections')}>
                Add a Google Maps Key
              </button>
              .
            </p>
          )}
        </div>
      )}

      {pricing && <PriceSheet station={pricing} onClose={() => setPricing(null)} />}
    </div>
  );
}

function PriceSheet({ station, onClose }: { station: Station; onClose: () => void }) {
  const [v, setV] = useState<number | null>(null);
  return (
    <Sheet
      title={station.name}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={!v || v < 1 || v > 9}
            onClick={async () => {
              await logGasPrice(station, v!);
              onClose();
            }}
          >
            Save Price
          </button>
        </>
      }
    >
      <Field label="Regular, per Gallon" hint="What the sign says today">
        <NumberInput value={v} onChange={setV} prefix="$" allowEmpty autoFocus placeholder="3.299" />
      </Field>
    </Sheet>
  );
}
