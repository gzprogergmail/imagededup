param([string]$BaseDir = "C:\dl\imagededup\sample-images")

$topics = @{
    "mountains"    = (101..160)
    "cats"         = (40..100)
    "architecture" = (164..230)
    "sunsets"      = (201..260)
    "abstract-art" = (301..360)
}

$resolutions = @(
    @{ w = 320;  h = 240  }
    @{ w = 640;  h = 480  }
    @{ w = 1280; h = 720  }
    @{ w = 1920; h = 1080 }
)

$downloaded = 0
$skipped = 0
$failed = 0

foreach ($topic in ($topics.Keys | Sort-Object)) {
    $dir = Join-Path $BaseDir $topic
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }

    foreach ($seed in $topics[$topic]) {
        foreach ($res in $resolutions) {
            $label = "$($res.w)x$($res.h)"
            $filename = "${topic}_seed${seed}_${label}.jpg"
            $dest = Join-Path $dir $filename

            if (Test-Path $dest) {
                $skipped++
                continue
            }

            $url = "https://picsum.photos/seed/$seed/$($res.w)/$($res.h)"
            try {
                Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing -TimeoutSec 30 -ErrorAction Stop
                $downloaded++
                Write-Host "  + $filename"
            } catch {
                $failed++
                Write-Warning "FAIL $url : $_"
            }
        }
    }
    Write-Host "[$topic] done"
}

Write-Host ""
Write-Host "=== Summary ==="
Write-Host "Downloaded : $downloaded"
Write-Host "Skipped    : $skipped"
Write-Host "Failed     : $failed"
Write-Host "Total files: $((Get-ChildItem $BaseDir -Recurse -Filter *.jpg).Count)"
