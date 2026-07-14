import { useEffect, useMemo, useState } from 'react';
import { Transaction } from '../../shared/types/transaction';
import { monthKey } from '../utils/format';

interface Props {
  transactions: Transaction[];
  currentMonth: string | null;
  onSelectMonth: (month: string) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

export default function MonthNavSidebar({
  transactions,
  currentMonth,
  onSelectMonth,
  collapsed,
  onToggleCollapsed,
}: Props) {
  const yearsToMonths = useMemo(() => {
    const map = new Map<string, Set<number>>();
    for (const tx of transactions) {
      const key = monthKey(tx.date); // yyyy-mm
      const [year, month] = key.split('-');
      if (!map.has(year)) map.set(year, new Set());
      map.get(year)!.add(Number(month));
    }
    return Array.from(map.entries())
      .sort((a, b) => Number(b[0]) - Number(a[0]))
      .map(([year, months]) => ({ year, months: Array.from(months).sort((a, b) => a - b) }));
  }, [transactions]);

  const currentYear = currentMonth?.split('-')[0];
  const [expandedYears, setExpandedYears] = useState<Set<string>>(
    () => new Set(currentYear ? [currentYear] : [])
  );

  useEffect(() => {
    if (currentYear) {
      setExpandedYears((prev) => (prev.has(currentYear) ? prev : new Set(prev).add(currentYear)));
    }
  }, [currentYear]);

  function toggleYear(year: string) {
    setExpandedYears((prev) => {
      const next = new Set(prev);
      if (next.has(year)) next.delete(year);
      else next.add(year);
      return next;
    });
  }

  if (collapsed) {
    return (
      <button className="sidebar-collapse-toggle" onClick={onToggleCollapsed} title="Show month navigator">
        ‹
      </button>
    );
  }

  return (
    <>
      <div className="sidebar-title">
        <span>Months</span>
        <button className="sidebar-collapse-toggle" onClick={onToggleCollapsed} title="Hide month navigator">
          ›
        </button>
      </div>
      {yearsToMonths.length === 0 ? (
        <div className="text-muted" style={{ fontSize: 13, padding: '0 10px' }}>
          No transactions yet.
        </div>
      ) : (
        <ul className="month-nav-years">
          {yearsToMonths.map(({ year, months }) => {
            const expanded = expandedYears.has(year);
            return (
              <li key={year}>
                <button className="month-nav-year" onClick={() => toggleYear(year)}>
                  <span>{expanded ? '▾' : '▸'}</span> {year}
                </button>
                {expanded && (
                  <ul className="month-nav-months">
                    {months.map((m) => {
                      const key = `${year}-${String(m).padStart(2, '0')}`;
                      const active = key === currentMonth;
                      return (
                        <li key={key}>
                          <button
                            className={`month-nav-month${active ? ' active' : ''}`}
                            onClick={() => onSelectMonth(key)}
                          >
                            {MONTH_NAMES[m - 1]}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
