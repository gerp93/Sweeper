import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { HelocSettings } from '../../shared/types/helocSettings';
import { computeFeeStatus } from '../utils/feeReminder';
import { formatCurrency, formatDate } from '../utils/format';

export default function FeeReminderBanner() {
  const location = useLocation();
  const [settings, setSettings] = useState<HelocSettings | null>(null);
  const [feeYears, setFeeYears] = useState<Set<number>>(new Set());
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    load();
    // Re-check whenever the user navigates, so changes made in Settings
    // (fee amount/date, marking a year as added) are picked up right away.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  async function load() {
    const [heloc, years] = await Promise.all([
      window.electronAPI.helocSettings.get(),
      window.electronAPI.helocSettings.getFeeYears(),
    ]);
    setSettings(heloc);
    setFeeYears(new Set(years));
  }

  async function markYear(year: number) {
    await window.electronAPI.helocSettings.markFeeYear(year);
    await load();
  }

  const status = computeFeeStatus(settings, feeYears);
  if (!status || dismissed) return null;

  const amount = settings?.annualFeeAmount ?? 0;
  const targetYear = status.years[0];

  return (
    <div className={`fee-banner ${status.type}`}>
      <span>
        {status.type === 'overdue' ? (
          <>
            <strong>{formatCurrency(amount)}</strong> AIO HELOC annual fee{' '}
            {status.years.length > 1 ? (
              <>hasn't been recorded for {status.years.join(', ')}</>
            ) : (
              <>was expected on {formatDate(status.feeDateDisplay)} and hasn't been recorded</>
            )}{' '}
            — it hits the HELOC directly and won't show up in your bank import.
          </>
        ) : (
          <>
            <strong>{formatCurrency(amount)}</strong> AIO HELOC annual fee is expected{' '}
            {formatDate(status.feeDateDisplay)} (in {status.daysUntil} day{status.daysUntil === 1 ? '' : 's'}) —
            remember, it won't show up in your bank import.
          </>
        )}
      </span>
      <div className="fee-banner-actions">
        <button className="btn" onClick={() => markYear(targetYear)}>
          Mark {targetYear} as added
        </button>
        <button className="fee-banner-close" onClick={() => setDismissed(true)} title="Dismiss for now">
          ×
        </button>
      </div>
    </div>
  );
}
