import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SimplefinSyncResult } from '../../shared/types/simplefinStatus';
import { formatCurrency, formatDate } from '../utils/format';

// Shows what the automated import just did. A failed sync stays on screen (also after a
// restart, from the saved status) until it is dismissed or a later sync works; a successful
// one only shows when it actually brought something in.
export default function SimplefinSyncBanner() {
  const navigate = useNavigate();
  const [result, setResult] = useState<SimplefinSyncResult | null>(null);
  const [dismissedAt, setDismissedAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.electronAPI.simplefin
      .getStatus()
      .then((status) => {
        if (!cancelled && status.connected && status.lastResult && !status.lastResult.ok) {
          setResult((current) => current ?? status.lastResult);
        }
      })
      .catch(() => {});
    const unsubscribe = window.electronAPI.simplefin.onSyncFinished((r) => {
      setResult(r);
      setDismissedAt(null);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  if (!result || dismissedAt === result.finishedAt) return null;
  const reconcile = result.ok ? result.reconcile ?? null : null;
  const reconcileNote =
    reconcile?.status === 'recorded'
      ? `Reconciled automatically as of ${reconcile.asOfDate ? formatDate(reconcile.asOfDate) : 'today'}.`
      : reconcile?.status === 'mismatch'
        ? `The bank balance is off from Sweeper by ${formatCurrency(reconcile.difference ?? 0)}; nothing was reconciled.`
        : null;
  if (result.ok && result.imported === 0 && result.messages.length === 0 && !reconcileNote) return null;

  const failed = !result.ok;
  let text: string;
  if (failed) {
    text = `Automated import didn't run: ${result.messages[0] ?? 'unknown error'}`;
  } else if (result.imported > 0) {
    text = `Imported ${result.imported} new transaction${result.imported === 1 ? '' : 's'} from your bank.`;
    if (result.newAccounts > 0) {
      text += ` ${result.newAccounts} new account${result.newAccounts === 1 ? ' was' : 's were'} added; rename or merge them in Accounts.`;
    }
    if (result.messages.length > 0) text += ` Your bank also reported: ${result.messages[0]}`;
  } else if (result.messages.length > 0) {
    text = `Automated import: ${result.messages[0]}`;
  } else {
    text = 'Automated import ran; no new transactions.';
  }
  if (failed === false && reconcileNote) text += ` ${reconcileNote}`;

  return (
    <div
      className={`fee-banner ${
        failed || result.messages.length > 0 || reconcile?.status === 'mismatch' ? 'overdue' : 'upcoming'
      }`}
    >
      <span>{text}</span>
      <div className="fee-banner-actions">
        <button className="btn" onClick={() => navigate('/settings?tab=import')}>
          Automated import settings
        </button>
        <button className="fee-banner-close" onClick={() => setDismissedAt(result.finishedAt)} title="Dismiss">
          ×
        </button>
      </div>
    </div>
  );
}
