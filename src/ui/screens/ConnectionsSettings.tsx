import { useState } from 'react';
import { Landmark, Store } from 'lucide-react';
import { Field, Segmented, TextInput, useToast } from '../components';
import { findKrogerStores, refreshStorePrices } from '../../data/groceryActions';
import type { KrogerLocation } from '../../core/kroger';
import type { Settings } from '../../core/types';
import { krogerStoresOf } from '../../core/defaults';

type SetFn = (f: (s: Settings) => Settings) => void;

export function BankSettings({ s, set }: { s: Settings; set: SetFn }) {
  const i = s.integrations;
  const up = (patch: Partial<Settings['integrations']>) => set((x) => ({ ...x, integrations: { ...x.integrations, ...patch } }));
  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 12 }}>
        <Landmark />
        <h2 className="grow">Bank connections</h2>
      </div>
      <div className="col gap-l">
        <p className="small ink2">
          Pebbles connects to your banks (checking, cards, and Marcus) through Plaid, the same service many banking apps use. Plaid’s Trial plan is free for up to 10 bank logins. One-time setup:
        </p>
        <ol className="small ink2" style={{ margin: 0, paddingLeft: 18 }}>
          <li>
            Go to <strong>dashboard.plaid.com</strong> and sign up (it’s free). When asked, describe it as a personal budgeting app for yourself.
          </li>
          <li>Choose the free <strong>Trial</strong> plan when it’s offered, and turn on the <strong>Transactions</strong> product.</li>
          <li>
            Open <strong>Developers → Keys</strong>. Copy your <strong>client_id</strong> and your <strong>Production</strong> secret into the boxes below.
          </li>
          <li>
            In Pebbles go to <strong>Spending → Accounts → Connect a bank</strong>, sign in to your bank, then do the same for Marcus.
          </li>
        </ol>
        <div className="form-grid two">
          <Field label="Plaid client_id">
            <TextInput value={i.plaidClientId} onChange={(v) => up({ plaidClientId: v.trim() })} placeholder="e.g. 66f0…" />
          </Field>
          <Field label="Plaid secret">
            <TextInput type="password" value={i.plaidSecret} onChange={(v) => up({ plaidSecret: v.trim() })} placeholder="Production secret" />
          </Field>
        </div>
        <Field label="Environment" hint="Use Sandbox only to try it with Plaid’s fake test bank (user_good / pass_good).">
          <Segmented
            value={i.plaidEnv}
            options={[
              { value: 'production', label: 'Real banks' },
              { value: 'sandbox', label: 'Sandbox (test)' },
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
        <h2 className="grow">Grocery prices</h2>
      </div>
      <div className="col gap-l">
        <p className="small ink2">
          King Soopers (Kroger) shares live prices and weekly sales with apps. Create a free account at <strong>developer.kroger.com</strong>, register an app (Production, “Product” scope), and paste its client ID and secret here.
        </p>
        <div className="form-grid two">
          <Field label="Kroger client ID">
            <TextInput value={i.krogerClientId} onChange={(v) => up({ krogerClientId: v.trim() })} />
          </Field>
          <Field label="Kroger client secret">
            <TextInput type="password" value={i.krogerSecret} onChange={(v) => up({ krogerSecret: v.trim() })} />
          </Field>
          <Field label="Your ZIP code">
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
              {busy ? 'Finding…' : 'Find stores near me'}
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
                <Field label="Your King Soopers stores" hint="Pick every store you shop at. Prices are checked at each one.">
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
