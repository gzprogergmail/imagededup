$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

npm run lint
npm run test:unit
npm run test:e2e
npm run perf
npm run coverage:check
