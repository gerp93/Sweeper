import { contextBridge, ipcRenderer } from 'electron';
import { CreateAccountInput, UpdateAccountInput } from '../shared/types/account';
import { CreateTransactionInput, UpdateTransactionInput } from '../shared/types/transaction';
import { CreateImportRuleInput, UpdateImportRuleInput } from '../shared/types/importRule';
import { CreateImportBatchInput } from '../shared/types/importBatch';
import { CreateBalanceAnchorInput } from '../shared/types/balanceAnchor';
import { UpdateHelocSettingsInput } from '../shared/types/helocSettings';
import { CreateReconciliationInput } from '../shared/types/reconciliation';
import {
  CreateObligationInput,
  UpdateObligationInput,
  CreateObligationLineItemInput,
  UpdateObligationLineItemInput,
} from '../shared/types/obligation';
import { CreateIncomeProjectionInput, UpdateIncomeProjectionInput, ProjectionScenarioOptions } from '../shared/types/projection';
import { CreateRecurringBillInput, UpdateRecurringBillInput } from '../shared/types/recurringBill';

contextBridge.exposeInMainWorld('electronAPI', {
  accounts: {
    getAll: () => ipcRenderer.invoke('accounts:getAll'),
    getById: (id: string) => ipcRenderer.invoke('accounts:getById', id),
    create: (input: CreateAccountInput) => ipcRenderer.invoke('accounts:create', input),
    update: (id: string, input: UpdateAccountInput) => ipcRenderer.invoke('accounts:update', id, input),
    delete: (id: string) => ipcRenderer.invoke('accounts:delete', id),
    merge: (sourceId: string, targetId: string, memo?: string | null) =>
      ipcRenderer.invoke('accounts:merge', sourceId, targetId, memo),
  },

  accountAliases: {
    getAll: () => ipcRenderer.invoke('accountAliases:getAll'),
    getForAccount: (accountId: string) => ipcRenderer.invoke('accountAliases:getForAccount', accountId),
    create: (accountId: string, rawName: string) => ipcRenderer.invoke('accountAliases:create', accountId, rawName),
    delete: (id: string) => ipcRenderer.invoke('accountAliases:delete', id),
  },

  transactions: {
    getAll: () => ipcRenderer.invoke('transactions:getAll'),
    getById: (id: string) => ipcRenderer.invoke('transactions:getById', id),
    create: (input: CreateTransactionInput) => ipcRenderer.invoke('transactions:create', input),
    createBulk: (inputs: CreateTransactionInput[]) => ipcRenderer.invoke('transactions:createBulk', inputs),
    update: (id: string, input: UpdateTransactionInput) => ipcRenderer.invoke('transactions:update', id, input),
    delete: (id: string) => ipcRenderer.invoke('transactions:delete', id),
  },

  importRules: {
    getAll: () => ipcRenderer.invoke('importRules:getAll'),
    getActive: () => ipcRenderer.invoke('importRules:getActive'),
    create: (input: CreateImportRuleInput) => ipcRenderer.invoke('importRules:create', input),
    update: (id: string, input: UpdateImportRuleInput) => ipcRenderer.invoke('importRules:update', id, input),
    delete: (id: string) => ipcRenderer.invoke('importRules:delete', id),
  },

  importBatches: {
    getAll: () => ipcRenderer.invoke('importBatches:getAll'),
    create: (input: CreateImportBatchInput) => ipcRenderer.invoke('importBatches:create', input),
  },

  balanceAnchors: {
    getAll: () => ipcRenderer.invoke('balanceAnchors:getAll'),
    create: (input: CreateBalanceAnchorInput) => ipcRenderer.invoke('balanceAnchors:create', input),
    delete: (id: string) => ipcRenderer.invoke('balanceAnchors:delete', id),
  },

  balance: {
    getSpendable: (asOf?: string) => ipcRenderer.invoke('balance:getSpendable', asOf),
  },

  helocSettings: {
    get: () => ipcRenderer.invoke('helocSettings:get'),
    update: (input: UpdateHelocSettingsInput) => ipcRenderer.invoke('helocSettings:update', input),
    getFeeYears: () => ipcRenderer.invoke('helocSettings:getFeeYears'),
    markFeeYear: (year: number) => ipcRenderer.invoke('helocSettings:markFeeYear', year),
    unmarkFeeYear: (year: number) => ipcRenderer.invoke('helocSettings:unmarkFeeYear', year),
  },

  reconciliations: {
    getAll: () => ipcRenderer.invoke('reconciliations:getAll'),
    create: (input: CreateReconciliationInput) => ipcRenderer.invoke('reconciliations:create', input),
    delete: (id: string) => ipcRenderer.invoke('reconciliations:delete', id),
  },

  obligations: {
    getAll: () => ipcRenderer.invoke('obligations:getAll'),
    getTotal: () => ipcRenderer.invoke('obligations:getTotal'),
    create: (input: CreateObligationInput) => ipcRenderer.invoke('obligations:create', input),
    update: (id: string, input: UpdateObligationInput) => ipcRenderer.invoke('obligations:update', id, input),
    delete: (id: string) => ipcRenderer.invoke('obligations:delete', id),
    clone: (id: string, newTargetDate: string | null) => ipcRenderer.invoke('obligations:clone', id, newTargetDate),
  },

  obligationLineItems: {
    create: (obligationId: string, input: CreateObligationLineItemInput) =>
      ipcRenderer.invoke('obligationLineItems:create', obligationId, input),
    update: (id: string, input: UpdateObligationLineItemInput) =>
      ipcRenderer.invoke('obligationLineItems:update', id, input),
    delete: (id: string) => ipcRenderer.invoke('obligationLineItems:delete', id),
    move: (id: string, direction: 'up' | 'down') => ipcRenderer.invoke('obligationLineItems:move', id, direction),
  },

  projections: {
    getAll: () => ipcRenderer.invoke('projections:getAll'),
    create: (input: CreateIncomeProjectionInput) => ipcRenderer.invoke('projections:create', input),
    update: (id: string, input: UpdateIncomeProjectionInput) => ipcRenderer.invoke('projections:update', id, input),
    delete: (id: string) => ipcRenderer.invoke('projections:delete', id),
    getProjectedBalance: (targetDate: string, excludedIds?: string[], options?: ProjectionScenarioOptions) =>
      ipcRenderer.invoke('projections:getProjectedBalance', targetDate, excludedIds, options),
    getSeries: (months: number, excludedIds?: string[], options?: ProjectionScenarioOptions) =>
      ipcRenderer.invoke('projections:getSeries', months, excludedIds, options),
    getMonthlyIncomeOccurrences: (monthStart: string, monthEnd: string, excludedIds?: string[]) =>
      ipcRenderer.invoke('projections:getMonthlyIncomeOccurrences', monthStart, monthEnd, excludedIds),
  },

  recurringBills: {
    getAll: () => ipcRenderer.invoke('recurringBills:getAll'),
    create: (input: CreateRecurringBillInput) => ipcRenderer.invoke('recurringBills:create', input),
    update: (id: string, input: UpdateRecurringBillInput) => ipcRenderer.invoke('recurringBills:update', id, input),
    delete: (id: string) => ipcRenderer.invoke('recurringBills:delete', id),
    getMonthlyOccurrences: (monthStart: string, monthEnd: string) =>
      ipcRenderer.invoke('recurringBills:getMonthlyOccurrences', monthStart, monthEnd),
    getExpectedTotal: (windowStart: string, windowEnd: string) =>
      ipcRenderer.invoke('recurringBills:getExpectedTotal', windowStart, windowEnd),
    findCandidateMatches: (transactionIds: string[]) =>
      ipcRenderer.invoke('recurringBills:findCandidateMatches', transactionIds),
  },

  dbLocation: {
    get: () => ipcRenderer.invoke('dbLocation:get'),
    browseExisting: () => ipcRenderer.invoke('dbLocation:browseExisting'),
    browseNew: () => ipcRenderer.invoke('dbLocation:browseNew'),
    set: (newPath: string) => ipcRenderer.invoke('dbLocation:set', newPath),
    resetToDefault: () => ipcRenderer.invoke('dbLocation:resetToDefault'),
  },

  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
  },

  updates: {
    check: () => ipcRenderer.invoke('updates:check'),
  },
});
