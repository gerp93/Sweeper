export function formatCurrency(amount: number): string {
  return amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7); // yyyy-mm
}

export function monthLabel(key: string): string {
  const [year, month] = key.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function shiftMonthKey(key: string, delta: number): string {
  const [year, month] = key.split('-').map(Number);
  const totalMonths = year * 12 + (month - 1) + delta;
  const newYear = Math.floor(totalMonths / 12);
  const newMonth = (totalMonths % 12) + 1;
  return `${newYear}-${String(newMonth).padStart(2, '0')}`;
}

export function firstDayOfMonth(key: string): string {
  return `${key}-01`;
}

export function lastDayOfMonth(key: string): string {
  const [year, month] = key.split('-').map(Number);
  const last = new Date(year, month, 0); // day 0 of next month = last day of this month
  return `${year}-${String(month).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;
}
