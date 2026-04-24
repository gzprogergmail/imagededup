param(
  [switch]$SkipTests,
  [ValidateSet("dir", "linux", "win", "release")]
  [string]$Target = "release"
)

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

if (-not $SkipTests) {
  npm test
}

switch ($Target) {
  "dir" {
    npm run package:dir
  }
  "linux" {
    npm run release:linux
  }
  "win" {
    npm run release:win
  }
  default {
    npm run release
  }
}
