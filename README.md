![Sweeper logo](assets/logo.png)

# Sweeper

Bare-bones spend tracker for an AIO/HELOC checking companion account. Import a checking-account CSV statement, filter out the sweep/transfer plumbing (`LNS ADV FRM`, `LNS PAY TO`, etc.) via editable rules, and track the true HELOC spendable balance forward from a manually set starting balance anchor.

This repo follows the shared conventions in [gerp93/KVG_Standards](https://github.com/gerp93/KVG_Standards) (theming, release/CI, update-check, licensing, DB location) — see that repo for the rules this one is expected to keep up with.

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

Every push to `main` triggers [Auto Release](.github/workflows/auto-release.yml), which bumps a semantic version tag and calls [KVG_Standards' `release-electron.yml`](https://github.com/gerp93/KVG_Standards/blob/main/.github/workflows/release-electron.yml) to package Sweeper for Windows, macOS, and Linux via `electron-builder` and publish the installers to a new [GitHub Release](../../releases). [Cut Release](.github/workflows/cut-release.yml) is also available for a manually chosen version instead of the auto-bump. Since `auto-release.yml` bumps on every push regardless of content, a release with no real code change (e.g. picking up an updated KVG_Standards workflow) should go through a dated entry in [`VERSION_BUMP.md`](VERSION_BUMP.md) instead of an empty commit.

To download a build, go to the [Releases page](../../releases) and grab the installer for your platform from the latest release's assets:

- `*.exe` — Windows installer
- `*.dmg` — macOS disk image (initial install)
- `*.AppImage` — Linux AppImage

These builds are unsigned (no code-signing certificate is configured), so Windows SmartScreen and macOS Gatekeeper will warn about an unrecognized publisher — you'll need to click through ("More info" → "Run anyway" on Windows, or right-click → "Open" on macOS) to launch it.

### Auto-updates

Once installed, the packaged app checks this repo's Releases on launch and silently downloads any newer version via `electron-updater`. When a download finishes, you'll get a prompt to restart and install now, or it installs automatically the next time you quit. You only need to manually download from Releases for the very first install (or if you skip enough updates that a manual re-download is easier).
