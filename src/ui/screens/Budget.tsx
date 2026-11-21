import type { AppData } from '../../data/useData';
import type { GoTo } from '../App';
import { Segmented } from '../components';
import { PlanScreen } from './Plan';
import { BillsView } from './Bills';
import { TransactionsView } from './Spending';
import { InsightList } from '../InsightList';
import { GuidelinesCard } from '../AutopilotCards';
import { AccountsView } from './Accounts';

type View = 'plan' | 'bills' | 'spending' | 'accounts' | 'notes';

/** Where the money goes: the paycheck plan and bills, what you spent, and your bank accounts. */
export function BudgetScreen({ data, go, view, setView }: { data: AppData; go: GoTo; view?: string; setView: (v: View) => void }) {
  const v: View = view === 'spending' || view === 'accounts' || view === 'bills' || view === 'notes' ? view : 'plan';
  return (
    <div>
      <div className="subnav">
        <Segmented
          value={v}
          options={[
            { value: 'plan', label: 'Plan' },
            { value: 'bills', label: 'Bills' },
            { value: 'spending', label: 'Spending' },
            { value: 'accounts', label: 'Accounts' },
            { value: 'notes', label: 'Notes' },
          ]}
          onChange={setView}
        />
      </div>
      {v === 'plan' && <PlanScreen data={data} go={go} />}
      {v === 'bills' && <BillsView data={data} />}
      {v === 'spending' && <TransactionsView data={data} />}
      {v === 'notes' && <NotesView data={data} />}
      {v === 'accounts' && <AccountsView data={data} openSettings={() => go('settings', 'connections')} />}
    </div>
  );
}

/** Field notes: ways to save and habits to keep or quit, plus how you compare to what experts suggest. */
function NotesView({ data }: { data: AppData }) {
  return (
    <div>
      <div className="section-title">
        <h2>Field Notes</h2>
        <span className="small muted">From your own spending, bills and pay</span>
      </div>
      <div className="card">
        <InsightList items={data.insights} />
      </div>
      <GuidelinesCard data={data} />
    </div>
  );
}
