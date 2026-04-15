param(
  [string]$Target = "tests/.generated/manual"
)

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

node .\scripts\generate-test-images.mjs $Target
Write-Host "Fixtures generated in $Target"
