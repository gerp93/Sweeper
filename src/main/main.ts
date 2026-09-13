import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { autoUpdater } from 'electron-updater';
import * as path from 'path';
import * as fs from 'fs';
import { initDatabase, saveDatabase } from './database/schema';
import {
  pinUserDataPath,
  getConfiguredDbPath,
  getEffectiveDbPath,
  getDefaultDbPath,
  isUsingDefaultLocation,
  setDbPath,
  resetToDefaultDbPath,
} from './dbLocation';
import { AccountService } from './database/accountService';
import { TransactionService } from './database/transactionService';
import { ImportRuleService } from './database/importRuleService';
import { ImportBatchService } from './database/importBatchService';
import { BalanceAnchorService } from './database/balanceAnchorService';
import { BalanceService } from './database/balanceService';
import { HelocSettingsService } from './database/helocSettingsService';
import { ReconciliationService } from './database/reconciliationService';
import { ReserveService } from './database/reserveService';
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
import { Database } from 'sql.js';

pinUserDataPath();
app.setName('sweeper');

// Guards against a real race: if a second launch attempt's 'second-instance'
// event lands while this process is still awaiting initDatabase() (loading
// the sql.js WASM engine takes a moment), the handler below would see
// mainWindow as still null and create a *second* window ahead of the real
// startup flow -- one whose renderer calls the API before
// registerIPCHandlers() has run, permanently stuck showing "No handler
// registered" / default values, even though the database itself is
// completely fine. Only act on second-instance once startup has finished.
let appInitialized = false;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  // app.quit() has been observed leaving this process alive for hours
  // instead of exiting (the loser of the lock never reaches 'ready', so
  // there's no window/before-quit lifecycle to fall back on) -- force it.
  setTimeout(() => process.exit(0), 1000);
} else {
  app.on('second-instance', () => {
    if (!appInitialized) return;
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    } else {
      createWindow();
    }
  });
}

let mainWindow: BrowserWindow | null = null;
let db: Database | null = null;
let accountService: AccountService;
let transactionService: TransactionService;
let importRuleService: ImportRuleService;
let importBatchService: ImportBatchService;
let balanceAnchorService: BalanceAnchorService;
let balanceService: BalanceService;
let helocSettingsService: HelocSettingsService;
let reconciliationService: ReconciliationService;
let reserveService: ReserveService;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1300,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    icon: path.join(__dirname, '../../../assets/icon.png'),
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

function setupAutoUpdater() {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-downloaded', (info) => {
    dialog
      .showMessageBox(mainWindow!, {
        type: 'info',
        title: 'Update ready',
        message: `Sweeper ${info.version} has been downloaded.`,
        detail: 'Restart now to install it, or it will install automatically the next time you quit.',
        buttons: ['Restart Now', 'Later'],
        defaultId: 0,
        cancelId: 1,
      })
      .then((result) => {
        if (result.response === 0) {
          autoUpdater.quitAndInstall();
        }
      });
  });

  autoUpdater.on('error', (err) => {
    console.error('Auto-update error:', err);
  });

  autoUpdater.checkForUpdates().catch((err) => {
    console.error('Failed to check for updates:', err);
  });
}

interface UpdateCheckResult {
  status: 'available' | 'not-available' | 'error' | 'unsupported';
  version?: string;
  message?: string;
}

function checkForUpdatesNow(): Promise<UpdateCheckResult> {
  if (!app.isPackaged) {
    return Promise.resolve({ status: 'unsupported' });
  }

  return new Promise((resolve) => {
    const cleanup = () => {
      autoUpdater.removeListener('update-available', onAvailable);
      autoUpdater.removeListener('update-not-available', onNotAvailable);
      autoUpdater.removeListener('error', onError);
    };
    const onAvailable = (info: { version: string }) => {
      cleanup();
      resolve({ status: 'available', version: info.version });
    };
    const onNotAvailable = () => {
      cleanup();
      resolve({ status: 'not-available' });
    };
    const onError = (err: Error) => {
      cleanup();
      const message = err?.message ?? String(err);
      // A CI release job uploads the installer before it generates/uploads the update
      // manifest (it needs the installer's own SHA512 first) -- a check that lands in that
      // multi-minute gap 404s on the manifest even though the release itself is live.
      resolve({
        status: 'error',
        message: message.includes('Cannot find latest')
          ? 'A new version may still be uploading -- try again in a few minutes.'
          : message,
      });
    };

    autoUpdater.once('update-available', onAvailable);
    autoUpdater.once('update-not-available', onNotAvailable);
    autoUpdater.once('error', onError);
    autoUpdater.checkForUpdates().catch(onError);
  });
}

app.whenReady().then(async () => {
  // Belt-and-suspenders: this callback is registered unconditionally above,
  // so make it explicit that the process which lost the single-instance
  // lock must never touch the database, even if 'ready' somehow still
  // fires for it before app.quit()/process.exit() take effect.
  if (!gotLock) return;

  const configuredDbPath = getConfiguredDbPath();
  if (configuredDbPath && !fs.existsSync(configuredDbPath)) {
    const result = await dialog.showMessageBox({
      type: 'error',
      title: 'Database not found',
      message: "Sweeper can't find your configured database file.",
      detail: `Expected it at:\n${configuredDbPath}\n\nThis can happen if a drive is disconnected or a synced folder hasn't loaded yet. Reconnect it and relaunch, or switch back to the default location.`,
      buttons: ['Quit', 'Use Default Location'],
      defaultId: 0,
      cancelId: 0,
    });
    if (result.response === 1) {
      resetToDefaultDbPath();
      app.relaunch();
    }
    app.exit();
    return;
  }

  db = await initDatabase();
  accountService = new AccountService(db);
  transactionService = new TransactionService(db);
  importRuleService = new ImportRuleService(db);
  importBatchService = new ImportBatchService(db);
  balanceAnchorService = new BalanceAnchorService(db);
  balanceService = new BalanceService(balanceAnchorService, transactionService);
  helocSettingsService = new HelocSettingsService(db);
  reconciliationService = new ReconciliationService(db, balanceService);
  reserveService = new ReserveService(db);

  importRuleService.seedDefaultRules();

  registerIPCHandlers();

  createWindow();
  appInitialized = true;
  setupAutoUpdater();

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
  ipcMain.handle('accounts:merge', (_, sourceId: string, targetId: string, memo?: string | null) =>
    accountService.mergeAccounts(sourceId, targetId, memo)
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

  // Reconciliation handlers
  ipcMain.handle('reconciliations:getAll', () => reconciliationService.getAllReconciliations());
  ipcMain.handle('reconciliations:create', (_, input: CreateReconciliationInput) =>
    reconciliationService.createReconciliation(input)
  );
  ipcMain.handle('reconciliations:delete', (_, id: string) => {
    reconciliationService.deleteReconciliation(id);
    return { success: true };
  });

  // Reserve handlers
  ipcMain.handle('reserves:getAll', () => reserveService.getAllReserves());
  ipcMain.handle('reserves:getTotal', () => reserveService.getTotalReserved());
  ipcMain.handle('reserves:create', (_, input: CreateReserveInput) => reserveService.createReserve(input));
  ipcMain.handle('reserves:update', (_, id: string, input: UpdateReserveInput) =>
    reserveService.updateReserve(id, input)
  );
  ipcMain.handle('reserves:delete', (_, id: string) => {
    reserveService.deleteReserve(id);
    return { success: true };
  });

  // Reserve line item handlers
  ipcMain.handle('reserveLineItems:create', (_, reserveId: string, input: CreateReserveLineItemInput) =>
    reserveService.createLineItem(reserveId, input)
  );
  ipcMain.handle('reserveLineItems:update', (_, id: string, input: UpdateReserveLineItemInput) =>
    reserveService.updateLineItem(id, input)
  );
  ipcMain.handle('reserveLineItems:delete', (_, id: string) => reserveService.deleteLineItem(id));
  ipcMain.handle('reserveLineItems:move', (_, id: string, direction: 'up' | 'down') =>
    reserveService.moveLineItem(id, direction)
  );

  // Database location handlers
  ipcMain.handle('dbLocation:get', () => ({
    path: getEffectiveDbPath(),
    isDefault: isUsingDefaultLocation(),
    defaultPath: getDefaultDbPath(),
  }));

  ipcMain.handle('dbLocation:browseExisting', async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose an existing Sweeper database file',
      properties: ['openFile'],
      filters: [{ name: 'SQLite Database', extensions: ['db', 'sqlite', 'sqlite3'] }],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('dbLocation:browseNew', async () => {
    if (!mainWindow) return null;
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Choose where to store the Sweeper database',
      defaultPath: 'sweeper.db',
      filters: [{ name: 'SQLite Database', extensions: ['db'] }],
    });
    return result.canceled ? null : result.filePath ?? null;
  });

  ipcMain.handle('dbLocation:set', (_, newPath: string) => {
    if (db) {
      saveDatabase(db);
    }
    setDbPath(newPath);
    app.relaunch();
    app.exit();
    return { success: true };
  });

  ipcMain.handle('dbLocation:resetToDefault', () => {
    if (db) {
      saveDatabase(db);
    }
    resetToDefaultDbPath();
    app.relaunch();
    app.exit();
    return { success: true };
  });

  // App / update handlers
  ipcMain.handle('app:getVersion', () => app.getVersion());
  ipcMain.handle('updates:check', () => checkForUpdatesNow());
}
