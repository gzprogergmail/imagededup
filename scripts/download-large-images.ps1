param(
    [string]$BaseDir    = "C:\dl\imagededup\sample-images\large-files",
    [int]   $Target     = 100,
    [int]   $MinBytes   = 10MB,
    [int]   $LargeW     = 5000,
    [int]   $LargeH     = 5000,
    [int]   $SmallW     = 1920,
    [int]   $SmallH     = 1280,
    [int]   $MaxSeed    = 400
)

$largeDir = Join-Path $BaseDir "large"
$smallDir = Join-Path $BaseDir "small"

foreach ($d in $largeDir, $smallDir) {
    if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d | Out-Null }
}

$collected = 0
$tried     = 0
$failed    = 0
$skipped   = 0

Write-Host "Target : $Target pairs (large ≥ $([int]($MinBytes/1MB)) MB each)"
Write-Host "Large  : ${LargeW}x${LargeH}   Small: ${SmallW}x${SmallH}"
Write-Host "Output : $BaseDir"
Write-Host ""

for ($seed = 1; $seed -le $MaxSeed -and $collected -lt $Target; $seed++) {
    $tried++

    $largeName = "large_seed${seed}_${LargeW}x${LargeH}.jpg"
    $smallName = "small_seed${seed}_${SmallW}x${SmallH}.jpg"
    $largeDest = Join-Path $largeDir $largeName
    $smallDest = Join-Path $smallDir $smallName

    # ── Large image ───────────────────────────────────────────────────────────
    $gotLarge = $false
    if (Test-Path $largeDest) {
        $existingSize = (Get-Item $largeDest).Length
        if ($existingSize -ge $MinBytes) {
            Write-Host "  SKIP (already exists, $([math]::Round($existingSize/1MB,1)) MB) $largeName"
            $gotLarge = $true
            $skipped++
        } else {
            # File exists but too small — remove and retry
            Remove-Item $largeDest -Force
        }
    }

    if (-not $gotLarge) {
        $url = "https://picsum.photos/seed/$seed/${LargeW}/${LargeH}"
        try {
            $tmpLarge = "$largeDest.tmp"
            Invoke-WebRequest -Uri $url -OutFile $tmpLarge -UseBasicParsing -TimeoutSec 60 -ErrorAction Stop
            $size = (Get-Item $tmpLarge).Length
            if ($size -ge $MinBytes) {
                Move-Item $tmpLarge $largeDest -Force
                $gotLarge = $true
                Write-Host ("  + large  seed={0,-4}  {1,6:F1} MB  {2}" -f $seed, ($size/1MB), $largeName)
            } else {
                Remove-Item $tmpLarge -Force
                Write-Host ("  - skip   seed={0,-4}  {1,6:F1} MB  (below threshold)" -f $seed, ($size/1MB))
            }
        } catch {
            $failed++
            Write-Warning "  FAIL large seed=$seed : $_"
        }
    }

    if (-not $gotLarge) { continue }

    # ── Small image ───────────────────────────────────────────────────────────
    if (-not (Test-Path $smallDest)) {
        $url = "https://picsum.photos/seed/$seed/${SmallW}/${SmallH}"
        try {
            Invoke-WebRequest -Uri $url -OutFile $smallDest -UseBasicParsing -TimeoutSec 30 -ErrorAction Stop
            $sz = (Get-Item $smallDest).Length
            Write-Host ("  + small  seed={0,-4}  {1,6:F1} MB  {2}" -f $seed, ($sz/1MB), $smallName)
        } catch {
            $failed++
            Write-Warning "  FAIL small seed=$seed : $_"
            # Don't count the pair if small failed — but large is fine, skip the pair for now
            continue
        }
    }

    $collected++
    Write-Host ("  [{0}/{1}] collected" -f $collected, $Target)
}

Write-Host ""
Write-Host "=== Summary ==="
Write-Host "Seeds tried  : $tried"
Write-Host "Pairs saved  : $collected"
Write-Host "Pre-existing : $skipped"
Write-Host "Failed reqs  : $failed"
Write-Host ""
$largeCount = (Get-ChildItem $largeDir -Filter *.jpg -ErrorAction SilentlyContinue).Count
$smallCount = (Get-ChildItem $smallDir -Filter *.jpg -ErrorAction SilentlyContinue).Count
$totalMB    = [math]::Round(((Get-ChildItem $BaseDir -Recurse -Filter *.jpg |
                Measure-Object -Property Length -Sum).Sum) / 1MB, 1)
Write-Host "Large files  : $largeCount"
Write-Host "Small files  : $smallCount"
Write-Host "Total on disk: $totalMB MB"
