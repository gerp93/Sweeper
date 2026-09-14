import { app, shell, BrowserWindow, Menu, MenuItem } from 'electron';

const REPO_URL = 'https://github.com/gerp93/Sweeper';
const ISSUES_URL = `${REPO_URL}/issues`;

function focusedWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
}

function zoomIn(): void {
  const win = focusedWindow();
  if (!win) return;
  win.webContents.setZoomLevel(win.webContents.getZoomLevel() + 0.5);
}

function zoomOut(): void {
  const win = focusedWindow();
  if (!win) return;
  win.webContents.setZoomLevel(win.webContents.getZoomLevel() - 0.5);
}

function resetZoom(): void {
  const win = focusedWindow();
  if (!win) return;
  win.webContents.setZoomLevel(0);
}

/** Only ever hand a plain web URL to the system browser — without the scheme check, anything
 * that reaches openExternalUrl (including a file: or shell-handler URL) would be opened by the
 * OS with whatever application claims it. */
function isSafeExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function openExternalUrl(url: string): void {
  if (!isSafeExternalUrl(url)) return;
  void shell.openExternal(url);
}

/** Electron's zoomIn role binds CmdOrCtrl+= only; Ctrl++ (Shift+=) needs its own accelerator. */
const ZOOM_IN_ITEMS: Electron.MenuItemConstructorOptions[] = [
  { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: () => zoomIn() },
  { label: 'Zoom In', accelerator: 'CmdOrCtrl+Shift+=', visible: false, click: () => zoomIn() },
  { label: 'Zoom In', accelerator: 'CmdOrCtrl+numadd', visible: false, click: () => zoomIn() },
];

/**
 * A minimal application menu — no File, Edit, or Window, since this isn't a
 * document-editing or multi-window app and Electron's defaults for those
 * (New Window, Undo/Redo/Cut/Copy/Paste as menu-bar items, Minimize/Zoom)
 * don't apply here. Just View (dev tools while unpackaged, zoom, fullscreen)
 * and Help (repo/issues/version). Ported from the same pattern in
 * gerp93/RolePlaymate (and gerp93/Bracketeer's smaller adoption of it) per
 * KVG_Standards' electron-menu.md.
 */
export function setupApplicationMenu(): void {
  const isMac = process.platform === 'darwin';

  const viewMenu: Electron.MenuItemConstructorOptions = {
    label: 'View',
    submenu: [
      ...(!app.isPackaged
        ? [
            { role: 'reload' as const },
            { role: 'forceReload' as const },
            { role: 'toggleDevTools' as const },
            { type: 'separator' as const },
          ]
        : []),
      ...ZOOM_IN_ITEMS,
      { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => zoomOut() },
      { label: 'Zoom Out', accelerator: 'CmdOrCtrl+numsub', visible: false, click: () => zoomOut() },
      { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: () => resetZoom() },
      { type: 'separator' as const },
      { role: 'togglefullscreen' as const },
    ],
  };

  const helpMenu: Electron.MenuItemConstructorOptions = {
    label: 'Help',
    role: 'help',
    submenu: [
      { label: 'GitHub Repository', click: () => openExternalUrl(REPO_URL) },
      { label: 'Report an Issue', click: () => openExternalUrl(ISSUES_URL) },
      { type: 'separator' as const },
      { label: `Version ${app.getVersion()}`, enabled: false },
    ],
  };

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),
    viewMenu,
    helpMenu,
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/** Right-click cut/copy/paste/select-all (plus spellcheck suggestions) on editable fields — needed because the app menu above has no Edit menu to expose those actions from. */
export function attachContextMenu(win: BrowserWindow): void {
  win.webContents.on('context-menu', (_event, params) => {
    const menu = new Menu();

    for (const suggestion of params.dictionarySuggestions) {
      menu.append(new MenuItem({ label: suggestion, click: () => win.webContents.replaceMisspelling(suggestion) }));
    }

    if (params.misspelledWord) {
      menu.append(
        new MenuItem({
          label: 'Add to dictionary',
          click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord!),
        })
      );
    }

    if (params.dictionarySuggestions.length > 0 || params.misspelledWord) {
      menu.append(new MenuItem({ type: 'separator' }));
    }

    if (params.isEditable) {
      if (params.editFlags.canCut) menu.append(new MenuItem({ role: 'cut' }));
      if (params.editFlags.canCopy) menu.append(new MenuItem({ role: 'copy' }));
      if (params.editFlags.canPaste) menu.append(new MenuItem({ role: 'paste' }));
      if (params.editFlags.canSelectAll) menu.append(new MenuItem({ role: 'selectAll' }));
    }

    if (menu.items.length === 0) return;
    menu.popup({ window: win });
  });
}
