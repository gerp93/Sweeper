import { useEffect, useState } from 'react';
import { formatCurrency } from '../utils/format';

interface Props {
  value: string; // raw numeric string, e.g. "200000" or ""
  onChange: (value: string) => void;
  placeholder?: string;
}

export default function CurrencyInput({ value, onChange, placeholder }: Props) {
  const [focused, setFocused] = useState(false);
  const [rawText, setRawText] = useState(value);

  useEffect(() => {
    if (!focused) setRawText(value);
  }, [value, focused]);

  function handleFocus() {
    setFocused(true);
    setRawText(value);
  }

  function handleBlur() {
    setFocused(false);
    const cleaned = rawText.replace(/[^0-9.-]/g, '');
    const num = parseFloat(cleaned);
    if (cleaned === '' || isNaN(num)) {
      onChange('');
    } else {
      onChange(String(num));
    }
  }

  const displayValue = focused ? rawText : value !== '' && !isNaN(parseFloat(value)) ? formatCurrency(parseFloat(value)) : '';

  return (
    <input
      type="text"
      inputMode="decimal"
      value={displayValue}
      onChange={(e) => setRawText(e.target.value)}
      onFocus={handleFocus}
      onBlur={handleBlur}
      placeholder={placeholder}
    />
  );
}
