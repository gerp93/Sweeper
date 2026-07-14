import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { initDatabase, saveDatabase } from './database/schema';
import { AccountService } from './database/accountService';
import { TransactionService } from './database/transactionService';
import { ImportRuleService } from './database/importRuleService';
import { ImportBatchService } from './database/importBatchService';
import { BalanceAnchorService } from './database/balanceAnchorService';
import { BalanceService } from './database/balanceService';
import { HelocSettingsService } from './database/helocSettingsService';
import { CreateAccountInput, UpdateAccountInput } from '../shared/types/account';
import { CreateTransactionInput, UpdateTransactionInput } from '../shared/types/transaction';
import { CreateImportRuleInput, UpdateImportRuleInput } from '../shared/types/importRule';
import { CreateImportBatchInput } from '../shared/types/importBatch';
import { CreateBalanceAnchorInput } from '../shared/types/balanceAnchor';
import { UpdateHelocSettingsInput } from '../shared/types/helocSettings';
import { Database } from 'sql.js';

let mainWindow: BrowserWindow | null = null;
let db: Database | null = null;
let accountService: AccountService;
let transactionService: TransactionService;
let importRuleService: ImportRuleService;
let importBatchService: ImportBatchService;
let balanceAnchorService: BalanceAnchorService;
let balanceService: BalanceService;
let helocSettingsService: HelocSettingsService;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1300,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    titleBarStyle: 'default',
    backgroundColor: '#f5f5f5',
  });

  if (!app.isPackaged) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  db = await initDatabase();
  accountService = new AccountService(db);
  transactionService = new TransactionService(db);
  importRuleService = new ImportRuleService(db);
  importBatchService = new ImportBatchService(db);
  balanceAnchorService = new BalanceAnchorService(db);
  balanceService = new BalanceService(balanceAnchorService, transactionService);
  helocSettingsService = new HelocSettingsService(db);

  importRuleService.seedDefaultRules();

  registerIPCHandlers();

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (db) {
    saveDatabase(db);
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

function registerIPCHandlers() {
  // Account handlers
  ipcMain.handle('accounts:getAll', () => accountService.getAllAccounts());
  ipcMain.handle('accounts:getById', (_, id: string) => accountService.getAccountById(id));
  ipcMain.handle('accounts:getByRawName', (_, rawName: string) => accountService.getAccountByRawName(rawName));
  ipcMain.handle('accounts:create', (_, input: CreateAccountInput) => accountService.createAccount(input));
  ipcMain.handle('accounts:update', (_, id: string, input: UpdateAccountInput) => accountService.updateAccount(id, input));
  ipcMain.handle('accounts:delete', (_, id: string) => {
    accountService.deleteAccount(id);
    return { success: true };
  });
  ipcMain.handle('accounts:findOrCreate', (_, rawName: string, friendlyName: string) =>
    accountService.findOrCreateByRawName(rawName, friendlyName)
  );
  ipcMain.handle('accounts:merge', (_, sourceId: string, targetId: string) =>
    accountService.mergeAccounts(sourceId, targetId)
  );

  // Transaction handlers
  ipcMain.handle('transactions:getAll', () => transactionService.getAllTransactions());
  ipcMain.handle('transactions:getById', (_, id: string) => transactionService.getTransactionById(id));
  ipcMain.handle('transactions:create', (_, input: CreateTransactionInput) => transactionService.createTransaction(input));
  ipcMain.handle('transactions:createBulk', (_, inputs: CreateTransactionInput[]) =>
    transactionService.createTransactionsBulk(inputs)
  );
  ipcMain.handle('transactions:update', (_, id: string, input: UpdateTransactionInput) =>
    transactionService.updateTransaction(id, input)
  );
  ipcMain.handle('transactions:delete', (_, id: string) => {
    transactionService.deleteTransaction(id);
    return { success: true };
  });

  // Import rule handlers
  ipcMain.handle('importRules:getAll', () => importRuleService.getAllRules());
  ipcMain.handle('importRules:getActive', () => importRuleService.getActiveRules());
  ipcMain.handle('importRules:create', (_, input: CreateImportRuleInput) => importRuleService.createRule(input));
  ipcMain.handle('importRules:update', (_, id: string, input: UpdateImportRuleInput) =>
    importRuleService.updateRule(id, input)
  );
  ipcMain.handle('importRules:delete', (_, id: string) => {
    importRuleService.deleteRule(id);
    return { success: true };
  });

  // Import batch handlers
  ipcMain.handle('importBatches:getAll', () => importBatchService.getAllBatches());
  ipcMain.handle('importBatches:create', (_, input: CreateImportBatchInput) => importBatchService.createBatch(input));

  // Balance anchor handlers
  ipcMain.handle('balanceAnchors:getAll', () => balanceAnchorService.getAllAnchors());
  ipcMain.handle('balanceAnchors:create', (_, input: CreateBalanceAnchorInput) => balanceAnchorService.createAnchor(input));
  ipcMain.handle('balanceAnchors:delete', (_, id: string) => {
    balanceAnchorService.deleteAnchor(id);
    return { success: true };
  });

  // Balance handler
  ipcMain.handle('balance:getSpendable', (_, asOf?: string) => balanceService.getSpendableBalance(asOf));

  // HELOC settings handlers
  ipcMain.handle('helocSettings:get', () => helocSettingsService.get());
  ipcMain.handle('helocSettings:update', (_, input: UpdateHelocSettingsInput) => helocSettingsService.update(input));
  ipcMain.handle('helocSettings:getFeeYears', () => helocSettingsService.getFeeYears());
  ipcMain.handle('helocSettings:markFeeYear', (_, year: number) => {
    helocSettingsService.markFeeYear(year);
    return { success: true };
  });
  ipcMain.handle('helocSettings:unmarkFeeYear', (_, year: number) => {
    helocSettingsService.unmarkFeeYear(year);
    return { success: true };
  });
}
