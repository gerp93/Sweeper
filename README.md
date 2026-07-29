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

Every push to `main` triggers the [Build workflow](.github/workflows/build.yml), which packages Sweeper for Windows, macOS, and Linux via `electron-builder` and publishes the installers to a new tagged [GitHub Release](../../releases) (`v<version>-<run-number>`).

To download a build, go to the [Releases page](../../releases) and grab the installer for your platform from the latest release's assets:

- `*.exe` — Windows installer
- `*.dmg` — macOS disk image
- `*.AppImage` — Linux AppImage

These builds are unsigned (no code-signing certificate is configured), so Windows SmartScreen and macOS Gatekeeper will warn about an unrecognized publisher — you'll need to click through ("More info" → "Run anyway" on Windows, or right-click → "Open" on macOS) to launch it.

Since a release is published on every push to `main`, the version number bumps by run rather than semantic meaning — update `version` in `package.json` when you want a release to reflect an actual version bump.
