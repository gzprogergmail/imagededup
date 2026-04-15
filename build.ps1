$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

npm run package
Write-Host "Packaged app available under .\\release"
