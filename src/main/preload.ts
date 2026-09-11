import { contextBridge, ipcRenderer } from 'electron';
import { CreateAccountInput, UpdateAccountInput } from '../shared/types/account';
import { CreateTransactionInput, UpdateTransactionInput } from '../shared/types/transaction';
import { CreateImportRuleInput, UpdateImportRuleInput } from '../shared/types/importRule';
import { CreateImportBatchInput } from '../shared/types/importBatch';
import { CreateBalanceAnchorInput } from '../shared/types/balanceAnchor';
import { UpdateHelocSettingsInput } from '../shared/types/helocSettings';
import { CreateReconciliationInput } from '../shared/types/reconciliation';
import {
  CreateReserveInput,
  UpdateReserveInput,
  CreateReserveLineItemInput,
  UpdateReserveLineItemInput,
} from '../shared/types/reserve';

contextBridge.exposeInMainWorld('electronAPI', {
  accounts: {
    getAll: () => ipcRenderer.invoke('accounts:getAll'),
    getById: (id: string) => ipcRenderer.invoke('accounts:getById', id),
    getByRawName: (rawName: string) => ipcRenderer.invoke('accounts:getByRawName', rawName),
    create: (input: CreateAccountInput) => ipcRenderer.invoke('accounts:create', input),
    update: (id: string, input: UpdateAccountInput) => ipcRenderer.invoke('accounts:update', id, input),
    delete: (id: string) => ipcRenderer.invoke('accounts:delete', id),
    findOrCreate: (rawName: string, friendlyName: string) =>
      ipcRenderer.invoke('accounts:findOrCreate', rawName, friendlyName),
    merge: (sourceId: string, targetId: string, memo?: string | null) =>
      ipcRenderer.invoke('accounts:merge', sourceId, targetId, memo),
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

  reserves: {
    getAll: () => ipcRenderer.invoke('reserves:getAll'),
    getTotal: () => ipcRenderer.invoke('reserves:getTotal'),
    create: (input: CreateReserveInput) => ipcRenderer.invoke('reserves:create', input),
    update: (id: string, input: UpdateReserveInput) => ipcRenderer.invoke('reserves:update', id, input),
    delete: (id: string) => ipcRenderer.invoke('reserves:delete', id),
  },

  reserveLineItems: {
    create: (reserveId: string, input: CreateReserveLineItemInput) =>
      ipcRenderer.invoke('reserveLineItems:create', reserveId, input),
    update: (id: string, input: UpdateReserveLineItemInput) =>
      ipcRenderer.invoke('reserveLineItems:update', id, input),
    delete: (id: string) => ipcRenderer.invoke('reserveLineItems:delete', id),
    move: (id: string, direction: 'up' | 'down') => ipcRenderer.invoke('reserveLineItems:move', id, direction),
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
