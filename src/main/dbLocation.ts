import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';

interface AppConfig {
  dbPath?: string;
}

// A local dev run (npm run dev) and a packaged/installed build must never
// share a userData folder. The database layer (sql.js) keeps the whole file
// in memory and overwrites it wholesale on every save, so if both were ever
// open against the same file, whichever saved last would silently wipe out
// the other's data. Call this before anything else touches
// app.getPath('userData') (must run before Electron's 'ready' event).
export function pinUserDataPath(): void {
  const dirName = app.isPackaged ? 'sweeper' : 'sweeper-dev';
  app.setPath('userData', path.join(app.getPath('appData'), dirName));
}

function getConfigPath(): string {
  return path.join(app.getPath('userData'), 'app-config.json');
}

function readConfig(): AppConfig {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch {
    return {};
  }
}

function writeConfig(config: AppConfig): void {
  fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2));
}

export function getDefaultDbPath(): string {
  return path.join(app.getPath('userData'), 'sweeper.db');
}

// The raw configured override, if any — does NOT fall back to the default.
// Use this to detect a missing custom path before silently creating a new,
// empty database in its place.
export function getConfiguredDbPath(): string | undefined {
  const configured = readConfig().dbPath;
  return configured && configured.trim() !== '' ? configured : undefined;
}

/** The database file the app will actually load on startup: a user-chosen location, or the default. */
export function getEffectiveDbPath(): string {
  return getConfiguredDbPath() ?? getDefaultDbPath();
}

export function isUsingDefaultLocation(): boolean {
  return !getConfiguredDbPath();
}

/**
 * Point the app at a different SQLite file. If nothing exists yet at the new
 * location, the current database is copied there first so no data is lost.
 * If a file already exists there, it's left alone and simply adopted as-is.
 */
export function setDbPath(newPath: string): void {
  const currentPath = getEffectiveDbPath();

  if (!fs.existsSync(newPath) && fs.existsSync(currentPath)) {
    fs.mkdirSync(path.dirname(newPath), { recursive: true });
    fs.copyFileSync(currentPath, newPath);
  }

  writeConfig({ ...readConfig(), dbPath: newPath });
}

export function resetToDefaultDbPath(): void {
  const config = readConfig();
  delete config.dbPath;
  writeConfig(config);
}
