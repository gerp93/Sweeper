import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import IncomeProjections from './IncomeProjections';
import BalloonPayments from './BalloonPayments';
import RecurringBills from './RecurringBills';

type ProjectionsTab = 'income' | 'balloon' | 'recurring';

// Groups everything that feeds the month-by-month forecast under one page: pencilled-in income,
// balloon-style obligations, and recurring bills. Income Projections was always editable right
// here; Balloon Payments and Recurring Bills used to require leaving the page (they lived under
// a separate Obligations nav entry) even though they move the same forecast -- this removes that
// asymmetry. Each tab is its own full page component with its own data loading and CRUD state;
// this container only owns which one is active.
export default function Projections() {
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState<ProjectionsTab>(
    initialTab === 'balloon' ? 'balloon' : initialTab === 'recurring' ? 'recurring' : 'income'
  );

  return (
    <div>
      <div className="page-header">
        <h1>Projections</h1>
      </div>

      <div className="tab-bar">
        <button
          className={`tab-button${activeTab === 'income' ? ' active' : ''}`}
          onClick={() => setActiveTab('income')}
        >
          Income Projections
        </button>
        <button
          className={`tab-button${activeTab === 'balloon' ? ' active' : ''}`}
          onClick={() => setActiveTab('balloon')}
        >
          Balloon Payments
        </button>
        <button
          className={`tab-button${activeTab === 'recurring' ? ' active' : ''}`}
          onClick={() => setActiveTab('recurring')}
        >
          Recurring Bills
        </button>
      </div>

      {activeTab === 'income' && <IncomeProjections />}
      {activeTab === 'balloon' && <BalloonPayments />}
      {activeTab === 'recurring' && <RecurringBills />}
    </div>
  );
}
