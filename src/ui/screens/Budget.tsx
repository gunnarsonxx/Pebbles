import type { AppData } from '../../data/useData';
import type { GoTo } from '../App';
import { Segmented } from '../components';
import { PlanScreen } from './Plan';
import { BillsView } from './Bills';
import { TransactionsView } from './Spending';
import { AccountsView } from './Accounts';

type View = 'plan' | 'bills' | 'spending' | 'accounts';

/** Where the money goes: the paycheck plan and bills, what you spent, and your bank accounts. */
export function BudgetScreen({ data, go, view, setView }: { data: AppData; go: GoTo; view?: string; setView: (v: View) => void }) {
  const v: View = view === 'spending' || view === 'accounts' || view === 'bills' ? view : 'plan';
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
          ]}
          onChange={setView}
        />
      </div>
      {v === 'plan' && <PlanScreen data={data} go={go} />}
      {v === 'bills' && <BillsView data={data} />}
      {v === 'spending' && <TransactionsView data={data} />}
      {v === 'accounts' && <AccountsView data={data} openSettings={() => go('settings', 'connections')} />}
    </div>
  );
}
