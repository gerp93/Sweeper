export interface HelocSettings {
  originalAmount: number | null;
  originationDate: string | null;
  annualFeeAmount: number | null;
  annualFeeMonthDay: string | null; // "MM-DD", recurs every year
  updatedAt: string | null;
}

export interface UpdateHelocSettingsInput {
  originalAmount?: number | null;
  originationDate?: string | null;
  annualFeeAmount?: number | null;
  annualFeeMonthDay?: string | null;
}
