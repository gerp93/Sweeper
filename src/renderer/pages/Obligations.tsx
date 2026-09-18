import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import BalloonPayments from './BalloonPayments';
import RecurringBills from './RecurringBills';

type ObligationsTab = 'balloon' | 'recurring';

// Obligations groups two kinds of "money already spoken for" under one nav entry: one-off (or
// manually cloned) balloon-style payments with a single due date, and recurring bills detected
// or entered on a repeating schedule. Each tab is its own full page component with its own
// data-loading and CRUD state -- this container only owns which one is showing.
export default function Obligations() {
  // ?tab=recurring lets the old standalone /recurring-bills route redirect straight to the
  // right tab instead of always landing on Balloon Payments.
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<ObligationsTab>(
    searchParams.get('tab') === 'recurring' ? 'recurring' : 'balloon'
  );

  return (
    <div>
      <div className="page-header">
        <h1>Obligations</h1>
      </div>

      <div className="tab-bar">
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

      {activeTab === 'balloon' && <BalloonPayments />}
      {activeTab === 'recurring' && <RecurringBills />}
    </div>
  );
}
