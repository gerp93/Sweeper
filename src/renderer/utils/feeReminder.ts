import { HelocSettings } from '../../shared/types/helocSettings';

export interface FeeStatus {
  type: 'overdue' | 'upcoming';
  years: number[]; // ascending; oldest unmarked first
  feeDateDisplay: string; // ISO yyyy-mm-dd for the current year's occurrence
  daysUntil?: number; // only set for 'upcoming'
}

export function computeFeeStatus(
  settings: HelocSettings | null,
  feeYears: Set<number>,
  today: Date = new Date()
): FeeStatus | null {
  if (!settings?.annualFeeAmount || !settings.annualFeeMonthDay) return null;

  const [month, day] = settings.annualFeeMonthDay.split('-').map(Number);
  const currentYear = today.getFullYear();
  const originationDate = settings.originationDate ? new Date(`${settings.originationDate}T00:00:00`) : null;
  const startYear = originationDate ? originationDate.getFullYear() : currentYear;
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  const missingYears: number[] = [];
  for (let y = startYear; y <= currentYear; y++) {
    const feeDate = new Date(y, month - 1, day);
    // Skip the origination year if the fee's month/day falls before the HELOC
    // actually existed -- it couldn't have been charged that year.
    if (y === startYear && originationDate && feeDate < originationDate) continue;
    if (feeDate <= todayMidnight && !feeYears.has(y)) {
      missingYears.push(y);
    }
  }

  const monthDayStr = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  if (missingYears.length > 0) {
    return {
      type: 'overdue',
      years: missingYears,
      feeDateDisplay: `${currentYear}-${monthDayStr}`,
    };
  }

  const feeDateThisYear = new Date(currentYear, month - 1, day);
  const daysUntil = Math.round((feeDateThisYear.getTime() - todayMidnight.getTime()) / 86400000);
  if (daysUntil >= 0 && daysUntil <= 30 && !feeYears.has(currentYear)) {
    return {
      type: 'upcoming',
      years: [currentYear],
      feeDateDisplay: `${currentYear}-${monthDayStr}`,
      daysUntil,
    };
  }

  return null;
}
