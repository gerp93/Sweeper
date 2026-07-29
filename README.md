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

Every push to `main` triggers the [Build workflow](.github/workflows/build.yml), which packages Sweeper for Windows, macOS, and Linux via `electron-builder` and uploads the installers as workflow run artifacts.

To download a build:

1. Go to the [Actions tab](../../actions/workflows/build.yml) and open the latest successful run on `main`.
2. Download the artifact for your platform from the **Artifacts** section at the bottom of the run summary:
   - `sweeper-win` — Windows installer (`.exe`)
   - `sweeper-mac` — macOS disk image (`.dmg`)
   - `sweeper-linux` — Linux AppImage

These builds are unsigned (no code-signing certificate is configured), so Windows SmartScreen and macOS Gatekeeper will warn about an unrecognized publisher — you'll need to click through ("More info" → "Run anyway" on Windows, or right-click → "Open" on macOS) to launch it.

Artifacts are retained by GitHub for a limited time (default 90 days). For a permanent, versioned download link, cut a [GitHub Release](../../releases) and attach the installers manually, or extend the workflow to publish releases automatically.
