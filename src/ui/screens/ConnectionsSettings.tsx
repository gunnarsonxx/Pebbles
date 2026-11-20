import { useState } from 'react';
import { Fuel, Landmark, Store } from 'lucide-react';
import { Field, Segmented, TextInput, useToast } from '../components';
import { findKrogerStores, refreshStorePrices } from '../../data/groceryActions';
import type { KrogerLocation } from '../../core/kroger';
import type { Settings } from '../../core/types';
import { krogerStoresOf } from '../../core/defaults';
import { ANDROID_PACKAGE, COMMUNITY, PRICE_STORE_SHORT } from '../../core/edition';

type SetFn = (f: (s: Settings) => Settings) => void;

export function BankSettings({ s, set }: { s: Settings; set: SetFn }) {
  const i = s.integrations;
  const up = (patch: Partial<Settings['integrations']>) => set((x) => ({ ...x, integrations: { ...x.integrations, ...patch } }));
  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 12 }}>
        <Landmark />
        <h2 className="grow">Bank Connections</h2>
      </div>
      <div className="col gap-l">
        <p className="small ink2">
          Pebbles connects to your banks (checking, cards, and a savings account like Marcus) through Plaid, the same service many banking apps use. Plaid’s Trial plan is free for up to 10 bank
          logins. One-time setup:
        </p>
        <ol className="small ink2" style={{ margin: 0, paddingLeft: 18 }}>
          <li>
            Go to <strong>dashboard.plaid.com</strong> and sign up (it’s free). When asked, describe it as a personal budgeting app for yourself.
          </li>
          <li>
            Choose the free <strong>Trial</strong> plan when it’s offered, and turn on the <strong>Transactions</strong> product.
          </li>
          <li>
            Open <strong>Developers → Keys</strong>. Copy your <strong>client_id</strong> and your <strong>Production</strong> secret into the boxes below.
          </li>
          <li>
            In Pebbles go to <strong>Budget → Accounts → Connect a bank</strong>, sign in to your bank, then do the same for each other bank or savings account.
          </li>
        </ol>
        <div className="form-grid two">
          <Field label="Plaid Client ID">
            <TextInput value={i.plaidClientId} onChange={(v) => up({ plaidClientId: v.trim() })} placeholder="e.g. 66f0…" />
          </Field>
          <Field label="Plaid Secret">
            <TextInput type="password" value={i.plaidSecret} onChange={(v) => up({ plaidSecret: v.trim() })} placeholder="Production secret" />
          </Field>
        </div>
        <Field label="Environment" hint="Use Sandbox only to try it with Plaid’s fake test bank (user_good / pass_good).">
          <Segmented
            value={i.plaidEnv}
            options={[
              { value: 'production', label: 'Real Banks' },
              { value: 'sandbox', label: 'Sandbox (Test)' },
            ]}
            onChange={(v) => up({ plaidEnv: v })}
          />
        </Field>
        <p className="tiny muted">Your keys and bank access stay on your phone and computer, and travel between them only over your encrypted home sync.</p>
      </div>
    </div>
  );
}

export function GroceryPriceSettings({ s, set }: { s: Settings; set: SetFn }) {
  const toast = useToast();
  const i = s.integrations;
  const up = (patch: Partial<Settings['integrations']>) => set((x) => ({ ...x, integrations: { ...x.integrations, ...patch } }));
  const [stores, setStores] = useState<KrogerLocation[] | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 12 }}>
        <Store />
        <h2 className="grow">Grocery Prices</h2>
      </div>
      <div className="col gap-l">
        <p className="small ink2">
          {COMMUNITY ? 'Kroger and its stores (King Soopers, Ralphs, Fry’s, Smith’s, Fred Meyer, Harris Teeter and more)' : 'King Soopers (Kroger)'} shares live prices and weekly sales with apps.
          Create a free account at <strong>developer.kroger.com</strong>, register an app (Production, “Product” scope), and paste its client ID and secret here.
        </p>
        <div className="form-grid two">
          <Field label="Kroger Client ID">
            <TextInput value={i.krogerClientId} onChange={(v) => up({ krogerClientId: v.trim() })} />
          </Field>
          <Field label="Kroger Client Secret">
            <TextInput type="password" value={i.krogerSecret} onChange={(v) => up({ krogerSecret: v.trim() })} />
          </Field>
          <Field label="Your ZIP Code">
            <TextInput value={i.zip} onChange={(v) => up({ zip: v.trim() })} />
          </Field>
          <div style={{ alignSelf: 'end' }}>
            <button
              className="btn"
              disabled={busy || !i.krogerClientId || !i.krogerSecret || !i.zip}
              onClick={async () => {
                setBusy(true);
                try {
                  setStores(await findKrogerStores(i.zip));
                } catch (e) {
                  toast((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? 'Finding…' : 'Find Stores Near Me'}
            </button>
          </div>
        </div>
        {(() => {
          const chosen = krogerStoresOf(i);
          const toggle = (st: { id: string; name: string }) => {
            const on = chosen.some((x) => x.id === st.id);
            const next = on ? chosen.filter((x) => x.id !== st.id) : [...chosen, st];
            up({ krogerStores: next, krogerLocationId: '', krogerLocationName: '' });
            if (!on) setTimeout(() => void refreshStorePrices(true), 500);
          };
          return (
            <>
              {chosen.length > 0 && (
                <div className="row wrap" style={{ gap: 6 }}>
                  {chosen.map((c) => (
                    <button key={c.id} className="chip on" onClick={() => toggle(c)} title="Remove">
                      {c.name} ✕
                    </button>
                  ))}
                </div>
              )}
              {stores && (
                <Field label={`Your ${PRICE_STORE_SHORT} Stores`} hint="Pick every store you shop at. Prices are checked at each one.">
                  <div className="col" style={{ gap: 4 }}>
                    {stores.map((st) => {
                      const on = chosen.some((x) => x.id === st.id);
                      const label = `${st.name}${st.address ? ` · ${st.address}` : ''}`;
                      return (
                        <label key={st.id} className="row small" style={{ cursor: 'pointer', padding: '4px 0' }}>
                          <input type="checkbox" checked={on} onChange={() => toggle({ id: st.id, name: st.address ? `${st.name} (${st.address.split(',')[0]})` : st.name })} />
                          {label}
                        </label>
                      );
                    })}
                  </div>
                </Field>
              )}
            </>
          );
        })()}
        <p className="tiny muted">Walmart doesn’t offer prices to apps, so Pebbles uses what you paid on your Walmart receipts to compare.</p>
      </div>
    </div>
  );
}

export function GasStationSettings({ s, set }: { s: Settings; set: SetFn }) {
  const i = s.integrations;
  const up = (patch: Partial<Settings['integrations']>) => set((x) => ({ ...x, integrations: { ...x.integrations, ...patch } }));
  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 12 }}>
        <Fuel />
        <h2 className="grow">Gas Station Prices</h2>
      </div>
      <div className="col gap-l">
        <p className="small ink2" style={{ margin: 0 }}>
          Without this, Pebbles finds stations on OpenStreetMap (free) and prices them from your gas receipts and the prices you tap in. With a Google Maps key, it shows the prices stations post on
          Google Maps.
        </p>
        <ol className="small ink2" style={{ margin: 0, paddingLeft: 18 }}>
          <li>Go to console.cloud.google.com, make a project and turn on billing (a card is required).</li>
          <li>Turn on “Places API (New)”, then make an API key under Credentials.</li>
          <li>
            Recommended: under the key’s settings, set Application restrictions to <strong>Android apps</strong> with package <code>{ANDROID_PACKAGE}</code> and SHA-1{' '}
            <code>56:70:15:4D:F4:37:3C:66:C5:68:DF:CB:2B:3D:FD:36:8C:72:65:D9</code>, and API restrictions to <strong>Places API (New)</strong>.
          </li>
          <li>Paste it here. Pebbles checks Google at most 20 times a day and 400 a month, well under the 1,000 free lookups.</li>
        </ol>
        <Field label="Google Maps API Key (Optional)">
          <TextInput value={i.googlePlacesKey} onChange={(v) => up({ googlePlacesKey: v.trim() })} placeholder="AIza…" />
        </Field>
        {i.homeAddress && <p className="tiny muted">Home for gas prices: {i.homeAddress}</p>}
      </div>
    </div>
  );
}

/** Community build: one place that says which free keys to get, what each unlocks, and whether it's done. */
export function SetupGuide({ s }: { s: Settings }) {
  if (!COMMUNITY) return null;
  const i = s.integrations;
  const steps: { name: string; done: boolean; what: string; how: string; cost: string }[] = [
    {
      name: 'Your State and Pay',
      done: s.onboarded,
      what: 'Taxes, paychecks and your budget.',
      how: 'Done during setup. Upload a pay stub (Paycheck tab) and Pebbles matches your real taxes and deductions.',
      cost: 'Free',
    },
    {
      name: 'Gas Prices (EIA)',
      done: !!i.eiaApiKey,
      what: 'Weekly gas prices for your state or region, for your gas budget.',
      how: 'Go to eia.gov/opendata, choose Register, enter your email. The key arrives by email in a minute. Paste it in Prices & Updates below.',
      cost: 'Free',
    },
    {
      name: 'Bank Connections (Plaid)',
      done: !!(i.plaidClientId && i.plaidSecret),
      what: 'Your purchases, paychecks and balances come in on their own.',
      how: 'Follow the steps in Bank Connections below. Optional: you can also import bank statements (CSV) instead.',
      cost: 'Free Trial plan (up to 10 bank logins)',
    },
    {
      name: 'Grocery Prices (Kroger)',
      done: !!(i.krogerClientId && i.krogerSecret),
      what: 'Live prices and sales at Kroger-family stores. Skip it if you don’t shop at one; receipts still teach Pebbles your prices.',
      how: 'Steps are in Grocery Prices below.',
      cost: 'Free',
    },
    {
      name: 'Gas Station Prices (Google)',
      done: !!i.googlePlacesKey,
      what: 'Today’s prices at stations near you. Optional.',
      how: 'Steps are in Gas Stations below. Google gives a monthly free credit that covers normal use.',
      cost: 'Free for normal use',
    },
  ];
  const left = steps.filter((x) => !x.done).length;
  return (
    <div className="card">
      <h2 style={{ margin: '0 0 4px' }}>Set Pebbles Up for You</h2>
      <p className="small ink2" style={{ margin: '0 0 10px' }}>
        This is Pebbles Community: nothing personal is built in. Each connection uses your own free key, kept only on your devices. Everything works without them; each one just fills in more on its
        own.
        {left ? ` ${left} left.` : ' All set.'}
      </p>
      <div className="list">
        {steps.map((x) => (
          <div key={x.name} className="list-item" style={{ alignItems: 'flex-start' }}>
            <span className={x.done ? 'good strong' : 'muted'} style={{ width: 18 }}>
              {x.done ? '✓' : '○'}
            </span>
            <div className="grow">
              <div className="small strong">
                {x.name} <span className="tiny muted">· {x.cost}</span>
              </div>
              <div className="tiny ink2">{x.what}</div>
              {!x.done && <div className="tiny muted">{x.how}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
