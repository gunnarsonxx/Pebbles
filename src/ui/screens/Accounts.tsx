import { useState, useSyncExternalStore } from 'react';
import { Landmark, Link2, Plus, RefreshCw, Unlink, PiggyBank } from 'lucide-react';
import type { AppData } from '../../data/useData';
import { Field, NumberInput, Sheet, ToggleRow, TextInput, useConfirm, useToast } from '../components';
import { bankLog, connectBank, cancelConnect, disconnectBank, plaidCreds, syncAllBanks, syncBank } from '../../data/bank';
import { store } from '../../data/store';
import { usd } from '../../core/money';
import { fmtShort, today } from '../../core/dates';
import type { InFlight } from '../../core/paypal';
import type { Account, BankLink } from '../../core/types';

export function AccountsView({ data, openSettings }: { data: AppData; openSettings: () => void }) {
  const toast = useToast();
  const ask = useConfirm();
  const [status, setStatus] = useState<string | null>(null);
  const [editing, setEditing] = useState<Account | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const entries = useSyncExternalStore(bankLog.subscribe, bankLog.get);
  const hasKeys = !!plaidCreds();

  const connect = async (reconnect?: BankLink) => {
    try {
      const names = await connectBank(setStatus, reconnect);
      toast(names.length ? `Connected ${names.join(', ')}` : 'Connected');
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setStatus(null);
    }
  };

  const byLink = new Map<string, Account[]>();
  for (const a of data.accounts) {
    const k = a.linkId ?? 'manual';
    byLink.set(k, [...(byLink.get(k) ?? []), a]);
  }

  return (
    <div>
      <div className="card">
        <div className="card-head">
          <div>
            <div className="eyebrow">Connected Banks</div>
            <div className="small muted">Transactions and balances update on their own, a few times a day.</div>
          </div>
          {hasKeys && (
            <button
              className="btn small"
              disabled={refreshing}
              onClick={async () => {
                setRefreshing(true);
                await syncAllBanks(true);
                setRefreshing(false);
                toast('Banks checked');
              }}
            >
              <RefreshCw className={refreshing ? 'spin' : ''} /> {refreshing ? 'Checking…' : 'Refresh'}
            </button>
          )}
        </div>
        {!hasKeys ? (
          <div className="col">
            <p className="small ink2">
              Connect your checking account and Marcus so Pebbles sees every purchase, your paycheck and your savings balance automatically. It uses Plaid’s free Trial plan; setup takes about five
              minutes, once.
            </p>
            <button className="btn primary" style={{ alignSelf: 'flex-start' }} onClick={openSettings}>
              <Link2 /> Set Up Bank Connections
            </button>
          </div>
        ) : (
          <div className="col">
            {data.links.map((l) => (
              <div key={l.id} className="card tint" style={{ padding: 14 }}>
                <div className="row between wrap">
                  <div className="row">
                    <Landmark size={18} />
                    <div>
                      <div className="strong">{l.institution}</div>
                      <div className="tiny muted">
                        {l.lastSync ? `Updated ${new Date(l.lastSync).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : 'Waiting for first update'}
                      </div>
                    </div>
                  </div>
                  <div className="row">
                    <button
                      className="icon-btn"
                      aria-label="Refresh"
                      onClick={() =>
                        void syncBank(l)
                          .then(() => toast(`${l.institution} refreshed`))
                          .catch((e) => toast((e as Error).message))
                      }
                    >
                      <RefreshCw />
                    </button>
                    <button
                      className="icon-btn"
                      aria-label="Disconnect"
                      onClick={async () => {
                        if (await ask({ title: `Disconnect ${l.institution}?`, body: 'Transactions already in Pebbles stay.', confirm: 'Disconnect', danger: true })) await disconnectBank(l);
                      }}
                    >
                      <Unlink />
                    </button>
                  </div>
                </div>
                {l.error && (
                  <div className="row mt">
                    <span className="small warn grow">{l.error}</span>
                    <button className="btn small" onClick={() => void connect(l)}>
                      Sign In Again
                    </button>
                  </div>
                )}
                <AccountRows accounts={byLink.get(l.id) ?? []} onEdit={setEditing} inFlight={data.inFlight} />
              </div>
            ))}
            {status ? (
              <div className="card tint row" style={{ padding: 14 }}>
                <span className="sync-dot syncing" />
                <span className="small grow">{status}</span>
                <button className="btn small" onClick={cancelConnect}>
                  Cancel
                </button>
              </div>
            ) : (
              <button className="btn primary" style={{ alignSelf: 'flex-start' }} onClick={() => void connect()}>
                <Plus /> Connect a Bank
              </button>
            )}
          </div>
        )}
      </div>

      {hasKeys && (
        <div className="card mt">
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            Connection Status
          </div>
          {entries.length ? (
            <div className="list">
              {entries.slice(0, 10).map((e, i) => (
                <div key={i} className="row small" style={{ padding: '5px 0', alignItems: 'flex-start' }}>
                  <span className="muted num" style={{ minWidth: 92 }}>
                    {new Date(e.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </span>
                  <span className={e.error ? 'bad' : ''}>{e.msg}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="small muted">Nothing yet. If you finished signing in to a bank but it isn’t listed above, tap Refresh: Pebbles picks up any sign-in from the last 6 hours.</p>
          )}
        </div>
      )}

      {(byLink.get('manual') ?? []).length > 0 && (
        <div className="card mt">
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            From Imported Statements
          </div>
          <AccountRows accounts={byLink.get('manual') ?? []} onEdit={setEditing} inFlight={data.inFlight} />
        </div>
      )}

      {editing && <AccountSheet account={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function AccountRows({ accounts, onEdit, inFlight }: { accounts: Account[]; onEdit: (a: Account) => void; inFlight?: InFlight | null }) {
  if (!accounts.length) return null;
  return (
    <div className="list mt">
      {accounts.map((a) => (
        <button key={a.id} className="list-item" onClick={() => onEdit(a)}>
          <div className="list-icon">{a.type === 'savings' ? <PiggyBank /> : <Landmark />}</div>
          <div className="grow">
            <div className="strong ellipsis">
              {a.name}
              {a.mask ? ` ••${a.mask}` : ''}
            </div>
            <div className="tiny muted">
              {a.type}
              {a.holdsGoals ? ' · holds your goals' : ''}
              {a.apy ? ` · ${a.apy}% APY` : ''}
              {a.balanceDate ? ` · as of ${fmtShort(a.balanceDate)}` : ''}
            </div>
          </div>
          {a.balance != null && (
            <div style={{ textAlign: 'right' }}>
              <div className="amount">{usd(a.balance)}</div>
              {inFlight?.accountId === a.id && (
                <div className="tiny muted" title="PayPal purchases your bank hasn’t taken out yet">
                  ≈ {usd((a.available ?? a.balance) - inFlight.amount)} after PayPal
                </div>
              )}
            </div>
          )}
        </button>
      ))}
    </div>
  );
}

function AccountSheet({ account, onClose }: { account: Account; onClose: () => void }) {
  const [a, setA] = useState(account);
  return (
    <Sheet
      title={account.name}
      onClose={onClose}
      footer={
        <button
          className="btn primary"
          onClick={async () => {
            if (a.holdsGoals) {
              // only one account holds your goals
              const others = store.list('accounts').filter((x) => x.holdsGoals && x.id !== a.id);
              if (others.length)
                await store.putMany(
                  'accounts',
                  others.map((x) => ({ ...x, holdsGoals: false })),
                );
            }
            await store.put('accounts', a);
            onClose();
          }}
        >
          Save
        </button>
      }
    >
      <div className="col gap-l">
        <Field label="Name">
          <TextInput value={a.name} onChange={(v) => setA({ ...a, name: v })} />
        </Field>
        {a.type === 'savings' && (
          <>
            <ToggleRow
              title="My Savings Goals Live Here"
              hint="Pebbles keeps your goals in step with this account’s balance and adds its interest to them"
              on={!!a.holdsGoals}
              onChange={(v) => setA({ ...a, holdsGoals: v })}
            />
            <Field label="Interest Rate (APY)" hint="It’s on your Marcus app or statement. Pebbles projects your monthly interest from it.">
              <NumberInput value={a.apy ?? null} allowEmpty onChange={(v) => setA({ ...a, apy: v })} suffix="%" />
            </Field>
          </>
        )}
        {a.source !== 'plaid' && (
          <Field label="Current Balance (Optional)" hint="Connected banks fill this in automatically">
            <NumberInput value={a.balance ?? null} allowEmpty onChange={(v) => setA({ ...a, balance: v, balanceDate: today() })} prefix="$" />
          </Field>
        )}
        {a.type !== 'savings' && (
          <Field label="Account Type">
            <select className="input" value={a.type} onChange={(e) => setA({ ...a, type: e.target.value as Account['type'] })}>
              <option value="checking">Checking</option>
              <option value="savings">Savings</option>
              <option value="credit">Credit card</option>
              <option value="other">Other</option>
            </select>
          </Field>
        )}
      </div>
    </Sheet>
  );
}
