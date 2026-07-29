# Sweeper

Bare-bones spend tracker for an AIO/HELOC checking companion account. Import a checking-account CSV statement, filter out the sweep/transfer plumbing (`LNS ADV FRM`, `LNS PAY TO`, etc.) via editable rules, and track the true HELOC spendable balance forward from a manually set starting balance anchor.

## Development

```
npm install
npm run dev
```

## Build

```
npm run build
npm run package
```

## Releases

Every push to `main` triggers the [Build workflow](.github/workflows/build.yml), which packages Sweeper for Windows, macOS, and Linux via `electron-builder` and publishes the installers to a new [GitHub Release](../../releases) (version `1.0.<CI run number>`, not committed back to `package.json`).

To download a build, go to the [Releases page](../../releases) and grab the installer for your platform from the latest release's assets:

- `*.exe` — Windows installer
- `*.dmg` — macOS disk image (initial install)
- `*.AppImage` — Linux AppImage

These builds are unsigned (no code-signing certificate is configured), so Windows SmartScreen and macOS Gatekeeper will warn about an unrecognized publisher — you'll need to click through ("More info" → "Run anyway" on Windows, or right-click → "Open" on macOS) to launch it.

### Auto-updates

Once installed, the packaged app checks this repo's Releases on launch and silently downloads any newer version via `electron-updater`. When a download finishes, you'll get a prompt to restart and install now, or it installs automatically the next time you quit. You only need to manually download from Releases for the very first install (or if you skip enough updates that a manual re-download is easier).
