import { useEffect, useMemo, useState } from 'react';
import { BalanceAnchor } from '../../shared/types/balanceAnchor';
import { HelocSettings } from '../../shared/types/helocSettings';
import CurrencyInput from '../components/CurrencyInput';
import { todayIso } from '../utils/format';
import { useTheme } from '../context/ThemeContext';
import { THEME_LABELS } from '../utils/themes';

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export default function Settings() {
  const { currentTheme, setTheme, availableThemes } = useTheme();
  const [loading, setLoading] = useState(true);

  const [helocSettings, setHelocSettings] = useState<HelocSettings | null>(null);
  const [originalAmount, setOriginalAmount] = useState('');
  const [originationDate, setOriginationDate] = useState('');
  const [savingDetails, setSavingDetails] = useState(false);

  const [annualFeeAmount, setAnnualFeeAmount] = useState('');
  const [annualFeeMonth, setAnnualFeeMonth] = useState('');
  const [annualFeeDay, setAnnualFeeDay] = useState('');
  const [savingFee, setSavingFee] = useState(false);

  const [feeYears, setFeeYears] = useState<Set<number>>(new Set());

  const [existingAnchors, setExistingAnchors] = useState<BalanceAnchor[]>([]);
  const [anchorBalance, setAnchorBalance] = useState('');
  const [anchorDate, setAnchorDate] = useState(todayIso());
  const [anchorNote, setAnchorNote] = useState('');
  const [savingAnchor, setSavingAnchor] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const [anchorList, heloc, years] = await Promise.all([
      window.electronAPI.balanceAnchors.getAll(),
      window.electronAPI.helocSettings.get(),
      window.electronAPI.helocSettings.getFeeYears(),
    ]);
    setExistingAnchors(anchorList);
    const primary = anchorList[0] ?? null;
    setAnchorBalance(primary ? String(primary.balance) : '');
    setAnchorDate(primary?.asOfDate ?? todayIso());
    setAnchorNote(primary?.note ?? '');

    setHelocSettings(heloc);
    setOriginalAmount(heloc?.originalAmount != null ? String(heloc.originalAmount) : '');
    setOriginationDate(heloc?.originationDate ?? '');
    setAnnualFeeAmount(heloc?.annualFeeAmount != null ? String(heloc.annualFeeAmount) : '');
    if (heloc?.annualFeeMonthDay) {
      const [m, d] = heloc.annualFeeMonthDay.split('-');
      setAnnualFeeMonth(String(Number(m)));
      setAnnualFeeDay(String(Number(d)));
    } else {
      setAnnualFeeMonth('');
      setAnnualFeeDay('');
    }
    setFeeYears(new Set(years));
    setLoading(false);
  }

  async function handleSaveDetails() {
    setSavingDetails(true);
    try {
      const parsedAmount = originalAmount.trim() === '' ? null : parseFloat(originalAmount);
      await window.electronAPI.helocSettings.update({
        originalAmount: parsedAmount != null && !isNaN(parsedAmount) ? parsedAmount : null,
        originationDate: originationDate.trim() || null,
      });
      await load();
    } finally {
      setSavingDetails(false);
    }
  }

  const annualFeeMonthDay =
    annualFeeMonth && annualFeeDay ? `${annualFeeMonth.padStart(2, '0')}-${annualFeeDay.padStart(2, '0')}` : '';

  async function handleSaveFee() {
    setSavingFee(true);
    try {
      const parsedFee = annualFeeAmount.trim() === '' ? null : parseFloat(annualFeeAmount);
      await window.electronAPI.helocSettings.update({
        annualFeeAmount: parsedFee != null && !isNaN(parsedFee) ? parsedFee : null,
        annualFeeMonthDay: annualFeeMonthDay || null,
      });
      await load();
    } finally {
      setSavingFee(false);
    }
  }

  async function toggleFeeYear(year: number, marked: boolean) {
    if (marked) {
      await window.electronAPI.helocSettings.unmarkFeeYear(year);
    } else {
      await window.electronAPI.helocSettings.markFeeYear(year);
    }
    await load();
  }

  const parsedAnchorBalance = parseFloat(anchorBalance);
  const anchorValid = anchorBalance.trim() !== '' && !isNaN(parsedAnchorBalance) && anchorDate.trim() !== '';
  const primaryAnchor = existingAnchors[0] ?? null;
  const anchorDirty =
    anchorBalance !== (primaryAnchor ? String(primaryAnchor.balance) : '') ||
    anchorDate !== (primaryAnchor?.asOfDate ?? todayIso()) ||
    anchorNote !== (primaryAnchor?.note ?? '');

  async function handleSaveAnchor() {
    if (!anchorValid) return;
    setSavingAnchor(true);
    try {
      // Enforce a single starting balance: clear out any existing anchor(s), then write one fresh.
      for (const a of existingAnchors) {
        await window.electronAPI.balanceAnchors.delete(a.id);
      }
      await window.electronAPI.balanceAnchors.create({
        balance: parsedAnchorBalance,
        asOfDate: anchorDate,
        note: anchorNote.trim() || null,
      });
      await load();
    } finally {
      setSavingAnchor(false);
    }
  }

  const detailsDirty =
    originalAmount !== (helocSettings?.originalAmount != null ? String(helocSettings.originalAmount) : '') ||
    originationDate !== (helocSettings?.originationDate ?? '');

  const feeDirty =
    annualFeeAmount !== (helocSettings?.annualFeeAmount != null ? String(helocSettings.annualFeeAmount) : '') ||
    annualFeeMonthDay !== (helocSettings?.annualFeeMonthDay ?? '');

  const feeYearRange = useMemo(() => {
    if (!annualFeeAmount || !annualFeeMonthDay) return [];
    const currentYear = new Date().getFullYear();
    const startYear = originationDate ? Number(originationDate.slice(0, 4)) : currentYear;
    const years: number[] = [];
    for (let y = currentYear; y >= startYear; y--) years.push(y);
    return years;
  }, [annualFeeAmount, annualFeeMonthDay, originationDate]);

  return (
    <div>
      <div className="page-header">
        <h1>Settings</h1>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Theme</h2>
        <p className="text-muted" style={{ marginTop: -8, fontSize: 13 }}>
          Choose your preferred color theme for the app.
        </p>
        <div className="field">
          <label>App Theme</label>
          <select
            value={currentTheme || ''}
            onChange={(e) => setTheme(e.target.value as any)}
            style={{ maxWidth: 300 }}
          >
            {availableThemes.map((theme) => (
              <option key={theme} value={theme}>
                {THEME_LABELS[theme]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Starting Balance</h2>
        <p className="text-muted" style={{ marginTop: -8, fontSize: 13 }}>
          This is the amount that was originally available to draw on the loan on day one — or, if you don't have
          transaction history going back that far, whatever was available as of whatever date your data actually
          starts from. Everything else is computed forward (or backward) from this one point.
        </p>
        <p className="text-muted" style={{ marginTop: -8, fontSize: 13 }}>
          There's only ever one starting balance — editing it replaces whatever was set before.
        </p>
        {loading ? (
          <div className="empty-state">Loading…</div>
        ) : (
          <>
            <div className="grid-2">
              <div className="field">
                <label>HELOC Balance</label>
                <CurrencyInput value={anchorBalance} onChange={setAnchorBalance} placeholder="e.g. $28,398.23" />
              </div>
              <div className="field">
                <label>As Of Date</label>
                <input type="date" value={anchorDate} onChange={(e) => setAnchorDate(e.target.value)} />
              </div>
            </div>
            <div className="field">
              <label>Note (optional)</label>
              <input
                value={anchorNote}
                onChange={(e) => setAnchorNote(e.target.value)}
                placeholder="e.g. beginning of July"
              />
            </div>
            <button
              className="btn btn-primary"
              disabled={!anchorDirty || !anchorValid || savingAnchor}
              onClick={handleSaveAnchor}
            >
              {savingAnchor ? 'Saving…' : 'Save'}
            </button>
          </>
        )}
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>HELOC Details</h2>
        <p className="text-muted" style={{ marginTop: -8, fontSize: 13 }}>
          Static facts about the line of credit itself — not used in the spendable balance calculation, just kept
          for reference.
        </p>
        {loading ? (
          <div className="empty-state">Loading…</div>
        ) : (
          <>
            <div className="grid-2">
              <div className="field">
                <label>Original HELOC Amount</label>
                <CurrencyInput value={originalAmount} onChange={setOriginalAmount} placeholder="e.g. $200,000.00" />
              </div>
              <div className="field">
                <label>Origination Date</label>
                <input type="date" value={originationDate} onChange={(e) => setOriginationDate(e.target.value)} />
              </div>
            </div>
            <button className="btn btn-primary" disabled={!detailsDirty || savingDetails} onClick={handleSaveDetails}>
              {savingDetails ? 'Saving…' : 'Save'}
            </button>
          </>
        )}
      </div>

      <div className="card">
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Annual Fee Reminder</h2>
        <p className="text-muted" style={{ marginTop: -8, fontSize: 13 }}>
          This charge hits the HELOC directly and never appears in a checking-account import — set it here and
          you'll get a reminder banner when it's coming up or overdue for the year.
        </p>
        {loading ? (
          <div className="empty-state">Loading…</div>
        ) : (
          <>
            <div className="grid-2">
              <div className="field">
                <label>Annual AIO HELOC Fee</label>
                <CurrencyInput value={annualFeeAmount} onChange={setAnnualFeeAmount} placeholder="e.g. $50.00" />
              </div>
              <div className="field">
                <label>Fee Date (recurs yearly)</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <select value={annualFeeMonth} onChange={(e) => setAnnualFeeMonth(e.target.value)}>
                    <option value="">Month…</option>
                    {MONTH_NAMES.map((name, idx) => (
                      <option key={idx} value={idx + 1}>
                        {name}
                      </option>
                    ))}
                  </select>
                  <select value={annualFeeDay} onChange={(e) => setAnnualFeeDay(e.target.value)}>
                    <option value="">Day…</option>
                    {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <button className="btn btn-primary" disabled={!feeDirty || savingFee} onClick={handleSaveFee}>
              {savingFee ? 'Saving…' : 'Save'}
            </button>

            {feeYearRange.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-accent-blue)', textTransform: 'uppercase' }}>
                  Years Added
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 8 }}>
                  {feeYearRange.map((year) => {
                    const marked = feeYears.has(year);
                    return (
                      <label
                        key={year}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          fontSize: 13,
                          border: '1px solid var(--color-primary-action-hover)',
                          borderRadius: 6,
                          padding: '4px 10px',
                          cursor: 'pointer',
                          background: marked ? 'var(--color-primary-action-hover)' : 'transparent',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={marked}
                          onChange={() => toggleFeeYear(year, marked)}
                          style={{ width: 'auto' }}
                        />
                        {year}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
