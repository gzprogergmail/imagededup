# ImageDedup

ImageDedup is a local Electron desktop app for finding duplicate images in two passes:

- Fast pass: `imghash` perceptual hash lookup across 0, 90, 180, and 270 degree rotations with O(1) hashtable matching.
- Slow pass: `ssim.js` similarity scoring over normalized, rotated, and center-cropped variants to catch stronger transformations from the same source.

## Stack

- Electron
- TypeScript
- Vite
- `sharp`
- `imghash`
- `ssim.js`
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

## Project Layout

- `src/main`: Electron main process, IPC, and duplicate-detection services.
- `src/renderer`: renderer HTML, CSS, and DOM logic.
- `src/shared`: shared types and utility structures.
- `tests`: unit, e2e, and performance suites.
- `tools`: PowerShell maintenance helpers.
- `skills`: maintenance instructions for future Codex sessions.

More detail lives in [docs/architecture.md](docs/architecture.md) and [docs/testing.md](docs/testing.md).
