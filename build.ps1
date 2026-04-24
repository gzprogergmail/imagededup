param(
	[ValidateSet("dir", "linux", "win", "release")]
	[string]$Target = "release"
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

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

Write-Host "Release artifacts available under .\\release"
