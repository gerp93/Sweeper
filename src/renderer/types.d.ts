import { Account, CreateAccountInput, UpdateAccountInput } from '../shared/types/account';
import { Transaction, CreateTransactionInput, UpdateTransactionInput } from '../shared/types/transaction';
import { ImportRule, CreateImportRuleInput, UpdateImportRuleInput } from '../shared/types/importRule';
import { ImportBatch, CreateImportBatchInput } from '../shared/types/importBatch';
import { BalanceAnchor, CreateBalanceAnchorInput, SpendableBalance } from '../shared/types/balanceAnchor';
import { HelocSettings, UpdateHelocSettingsInput } from '../shared/types/helocSettings';
import { Reconciliation, CreateReconciliationInput } from '../shared/types/reconciliation';
import {
  Reserve,
  CreateReserveInput,
  UpdateReserveInput,
  CreateReserveLineItemInput,
  UpdateReserveLineItemInput,
} from '../shared/types/reserve';

declare global {
  interface Window {
    electronAPI: {
      accounts: {
        getAll: () => Promise<Account[]>;
        getById: (id: string) => Promise<Account | null>;
        getByRawName: (rawName: string) => Promise<Account | null>;
        create: (input: CreateAccountInput) => Promise<Account>;
        update: (id: string, input: UpdateAccountInput) => Promise<Account>;
        delete: (id: string) => Promise<{ success: boolean }>;
        findOrCreate: (rawName: string, friendlyName: string) => Promise<Account>;
        merge: (sourceId: string, targetId: string, memo?: string | null) => Promise<Account>;
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
      reserves: {
        getAll: () => Promise<Reserve[]>;
        getTotal: () => Promise<number>;
        create: (input: CreateReserveInput) => Promise<Reserve>;
        update: (id: string, input: UpdateReserveInput) => Promise<Reserve>;
        delete: (id: string) => Promise<{ success: boolean }>;
      };
      reserveLineItems: {
        create: (reserveId: string, input: CreateReserveLineItemInput) => Promise<Reserve>;
        update: (id: string, input: UpdateReserveLineItemInput) => Promise<Reserve>;
        delete: (id: string) => Promise<Reserve>;
        move: (id: string, direction: 'up' | 'down') => Promise<Reserve>;
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
