![Sweeper logo](assets/logo.png)

# Sweeper

Bare-bones spend tracker for an AIO/HELOC checking companion account. Import a checking-account CSV statement, filter out the sweep/transfer plumbing (`LNS ADV FRM`, `LNS PAY TO`, etc.) via editable rules, and track the true HELOC spendable balance forward from a manually set starting balance anchor.

This repo follows the shared conventions in [gerp93/KVG_Standards](https://github.com/gerp93/KVG_Standards) (theming, release/CI, update-check, licensing, DB location) — see that repo for the rules this one is expected to keep up with.

## Automated import (SimpleFIN Bridge)

Instead of exporting a CSV, Sweeper can pull transactions straight from the bank through
[SimpleFIN Bridge](https://www.simplefin.org/) (a paid service that connects to the bank).

1. In SimpleFIN Bridge, connect the bank and create a new app connection. Copy its **setup token**.
2. In Sweeper, open **Settings > Automated Import**, paste the token and press **Connect**.
   A setup token works once; if it was already used, make a new one.
3. If the bank has more than one account, tick the ones to import.

From then on Sweeper imports new posted transactions every time it opens (at most once an hour,
because SimpleFIN allows about 24 refreshes a day) and again every 24 hours while it stays open
(counted from the last successful import; SimpleFIN doesn't publish a time of day for its own
refresh, only "daily updates"). A failed scheduled sync retries after an hour. There is no
background service: when Sweeper is closed nothing runs, and the next launch catches up.
**Sync now** imports on demand. Imports
use the same import rules and account names as the CSV import, and a transaction is never
imported twice: each is remembered by its SimpleFIN id, and the first sync skips rows that were
already imported by hand (same amount, same day or a day either side). Pending transactions wait
until they post. A failed sync shows a notice at the top of the window and never blocks startup.
The CSV import stays available.

### Automatic reconciliation

Under **Reconcile against**, pick the account whose balance Sweeper should check (for example the
HELOC). After each import Sweeper reads that account's *available balance* (or its balance, when
SimpleFIN omits the available one) and compares it with Sweeper's computed balance as of the day the
bank stamped it. If they match to the cent, a reconciliation is recorded, the same as confirming on
the Reconcile page by hand. If they don't match, nothing is recorded (a reconciliation marks
earlier transactions as checked); the difference shows in Settings and in the notice at the top of
the window. No transactions are imported from the reconcile account unless it is also ticked under
**Import from**.

The access SimpleFIN gives Sweeper is a credential. It is kept in `simplefin.json` in Sweeper's
app-data folder (not in the database, which may live in a synced folder), encrypted with the
operating system's secret store, and is only sent to SimpleFIN. Sweeper refuses to save it on a
computer with no secret store. **Disconnect** removes it; to cut off access completely, also delete
the app connection at SimpleFIN Bridge.

## Development

```
npm install
npm run dev
```

## Tests

```
npm test
```

Runs the unit tests in `tests/` (SimpleFIN mapping and dedupe, with made-up data only).

## Build

```
npm run build
npm run package
```

## Releases

Every push to `main` triggers [Auto Release](.github/workflows/auto-release.yml), which bumps a semantic version tag and calls [KVG_Standards' `release-electron.yml`](https://github.com/gerp93/KVG_Standards/blob/main/.github/workflows/release-electron.yml) to package Sweeper for Windows, macOS, and Linux via `electron-builder` and publish the installers to a new [GitHub Release](../../releases). [Cut Release](.github/workflows/cut-release.yml) is also available for a manually chosen version instead of the auto-bump. Since `auto-release.yml` bumps on every push regardless of content, a release with no real code change (e.g. picking up an updated KVG_Standards workflow) should go through a dated entry in [`VERSION_BUMP.md`](VERSION_BUMP.md) instead of an empty commit.

To download a build, go to the [Releases page](../../releases) and grab the installer for your platform from the latest release's assets:

- `*.exe` — Windows installer
- `*.dmg` — macOS disk image (initial install)
- `*.AppImage` — Linux AppImage

These builds are unsigned (no code-signing certificate is configured), so Windows SmartScreen and macOS Gatekeeper will warn about an unrecognized publisher — you'll need to click through ("More info" → "Run anyway" on Windows, or right-click → "Open" on macOS) to launch it.

### Auto-updates

Once installed, the packaged app checks this repo's Releases on launch and silently downloads any newer version via `electron-updater`. When a download finishes, you'll get a prompt to restart and install now, or it installs automatically the next time you quit. You only need to manually download from Releases for the very first install (or if you skip enough updates that a manual re-download is easier).
