import { Account, CreateAccountInput, UpdateAccountInput } from '../shared/types/account';
import { AccountAlias } from '../shared/types/accountAlias';
import { Transaction, CreateTransactionInput, UpdateTransactionInput } from '../shared/types/transaction';
import { ImportRule, CreateImportRuleInput, UpdateImportRuleInput } from '../shared/types/importRule';
import { ImportBatch, CreateImportBatchInput } from '../shared/types/importBatch';
import { BalanceAnchor, CreateBalanceAnchorInput, SpendableBalance } from '../shared/types/balanceAnchor';
import { HelocSettings, UpdateHelocSettingsInput } from '../shared/types/helocSettings';
import { Reconciliation, CreateReconciliationInput } from '../shared/types/reconciliation';
import {
  Obligation,
  CreateObligationInput,
  UpdateObligationInput,
  CreateObligationLineItemInput,
  UpdateObligationLineItemInput,
} from '../shared/types/obligation';
import {
  IncomeProjection,
  CreateIncomeProjectionInput,
  UpdateIncomeProjectionInput,
  ProjectedBalancePoint,
  ProjectionSeriesPoint,
  ProjectionScenarioOptions,
} from '../shared/types/projection';

declare global {
  interface Window {
    electronAPI: {
      accounts: {
        getAll: () => Promise<Account[]>;
        getById: (id: string) => Promise<Account | null>;
        create: (input: CreateAccountInput) => Promise<Account>;
        update: (id: string, input: UpdateAccountInput) => Promise<Account>;
        delete: (id: string) => Promise<{ success: boolean }>;
        merge: (sourceId: string, targetId: string, memo?: string | null) => Promise<Account>;
      };
      accountAliases: {
        getAll: () => Promise<AccountAlias[]>;
        getForAccount: (accountId: string) => Promise<AccountAlias[]>;
        create: (accountId: string, rawName: string) => Promise<AccountAlias>;
        delete: (id: string) => Promise<{ success: boolean }>;
      };
      transactions: {
        getAll: () => Promise<Transaction[]>;
        getById: (id: string) => Promise<Transaction | null>;
        create: (input: CreateTransactionInput) => Promise<Transaction>;
        createBulk: (inputs: CreateTransactionInput[]) => Promise<Transaction[]>;
        update: (id: string, input: UpdateTransactionInput) => Promise<Transaction>;
        delete: (id: string) => Promise<{ success: boolean }>;
      };
      importRules: {
        getAll: () => Promise<ImportRule[]>;
        getActive: () => Promise<ImportRule[]>;
        create: (input: CreateImportRuleInput) => Promise<ImportRule>;
        update: (id: string, input: UpdateImportRuleInput) => Promise<ImportRule>;
        delete: (id: string) => Promise<{ success: boolean }>;
      };
      importBatches: {
        getAll: () => Promise<ImportBatch[]>;
        create: (input: CreateImportBatchInput) => Promise<ImportBatch>;
      };
      balanceAnchors: {
        getAll: () => Promise<BalanceAnchor[]>;
        create: (input: CreateBalanceAnchorInput) => Promise<BalanceAnchor>;
        delete: (id: string) => Promise<{ success: boolean }>;
      };
      balance: {
        getSpendable: (asOf?: string) => Promise<SpendableBalance>;
      };
      helocSettings: {
        get: () => Promise<HelocSettings | null>;
        update: (input: UpdateHelocSettingsInput) => Promise<HelocSettings>;
        getFeeYears: () => Promise<number[]>;
        markFeeYear: (year: number) => Promise<{ success: boolean }>;
        unmarkFeeYear: (year: number) => Promise<{ success: boolean }>;
      };
      reconciliations: {
        getAll: () => Promise<Reconciliation[]>;
        create: (input: CreateReconciliationInput) => Promise<Reconciliation>;
        delete: (id: string) => Promise<{ success: boolean }>;
      };
      obligations: {
        getAll: () => Promise<Obligation[]>;
        getTotal: () => Promise<number>;
        create: (input: CreateObligationInput) => Promise<Obligation>;
        update: (id: string, input: UpdateObligationInput) => Promise<Obligation>;
        delete: (id: string) => Promise<{ success: boolean }>;
      };
      obligationLineItems: {
        create: (obligationId: string, input: CreateObligationLineItemInput) => Promise<Obligation>;
        update: (id: string, input: UpdateObligationLineItemInput) => Promise<Obligation>;
        delete: (id: string) => Promise<Obligation>;
        move: (id: string, direction: 'up' | 'down') => Promise<Obligation>;
      };
      projections: {
        getAll: () => Promise<IncomeProjection[]>;
        create: (input: CreateIncomeProjectionInput) => Promise<IncomeProjection>;
        update: (id: string, input: UpdateIncomeProjectionInput) => Promise<IncomeProjection>;
        delete: (id: string) => Promise<{ success: boolean }>;
        getProjectedBalance: (
          targetDate: string,
          excludedIds?: string[],
          options?: ProjectionScenarioOptions
        ) => Promise<ProjectedBalancePoint>;
        getSeries: (
          months: number,
          excludedIds?: string[],
          options?: ProjectionScenarioOptions
        ) => Promise<ProjectionSeriesPoint[]>;
      };
      dbLocation: {
        get: () => Promise<{ path: string; isDefault: boolean; defaultPath: string }>;
        browseExisting: () => Promise<string | null>;
        browseNew: () => Promise<string | null>;
        set: (newPath: string) => Promise<{ success: boolean }>;
        resetToDefault: () => Promise<{ success: boolean }>;
      };
      app: {
        getVersion: () => Promise<string>;
      };
      updates: {
        check: () => Promise<{
          status: 'available' | 'not-available' | 'error' | 'unsupported';
          version?: string;
          message?: string;
        }>;
      };
    };
  }
}

export {};
