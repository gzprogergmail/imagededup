param(
  [switch]$SkipTests
)

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

if (-not $SkipTests) {
  npm test
}

npm run package
