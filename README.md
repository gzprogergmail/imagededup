# ImageDedup

ImageDedup is a local Electron desktop app for finding duplicate images.

- Fast pass: `imghash` perceptual hash lookup across 0, 90, 180, and 270 degree rotations with O(1) hashtable matching.

## Stack

- Electron
- TypeScript
- Vite
- `sharp`
- `imghash`
- Vitest
- Playwright

## Commands

- `.\init.ps1`: install npm dependencies and the Playwright Chromium browser.
- `.\build.ps1`: build release artifacts for the current platform into `release`.
- `npm run release:win`: build Windows `nsis` installer and portable `.exe` artifacts into `release`.
- `npm run release:linux`: build a Linux `AppImage` executable into `release`.
- `npm run package:dir`: build an unpacked app directory into `release` for local inspection.
- `.\start.ps1`: build and run the desktop app.
- `npm test`: lint, unit tests, e2e tests, performance tests, and coverage gate.

`build.ps1` and `tools/Build-Release.ps1` also accept `-Target dir|linux|win|release`.

Windows release builds generally need to run on Windows, or on Linux with the Wine toolchain installed so `electron-builder` can emit `.exe` targets.

## Installing Without Trusting a Downloaded Executable

ImageDedup is published as an npm package as well as platform executable artifacts. If you do not want to run a downloaded `.exe`, install or inspect the npm package instead:

```powershell
npm view imagededup
npm pack imagededup --dry-run
npx imagededup
```

The npm package includes a Node launcher, the built app, TypeScript source, docs, and project configuration needed to inspect how the release was made. Release tags are built in GitHub Actions, and npm publishes use provenance so the package can be tied back to the release workflow.

To build from source:

```powershell
git clone https://github.com/gzprogergmail/imagededup.git
cd imagededup
npm ci
npm run build
npm test
npm run package:dir
```

For executable artifacts from GitHub Releases, prefer artifacts attached to tagged releases and compare them with the release workflow output. The release workflow also publishes SHA256 checksum sidecars and scans packaged artifacts with ClamAV before creating the draft GitHub Release.

## Project Layout

- `src/main`: Electron main process, IPC, and duplicate-detection services.
- `src/renderer`: renderer HTML, CSS, and DOM logic.
- `src/shared`: shared types and utility structures.
- `tests`: unit, e2e, and performance suites.
- `tools`: PowerShell maintenance helpers.
- `skills`: maintenance instructions for future Codex sessions.

More detail lives in [docs/architecture.md](docs/architecture.md) and [docs/testing.md](docs/testing.md).
