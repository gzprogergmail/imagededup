# Release Maintenance

Use this skill when preparing a local desktop release of ImageDedup.

## Workflow

1. Run `.\tools\Run-Quality-Gates.ps1`.
2. If the checks pass, run `.\tools\Build-Release.ps1`.
3. Verify the packaged output in `release\win-unpacked`.

## Notes

- `build.ps1` is the top-level packaging entrypoint.
- The packaged app is local-only and contains no network API dependency.
