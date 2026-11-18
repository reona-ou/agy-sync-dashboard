param(
  [string]$SyncDir = "",
  [string]$DeviceName = "",
  [string]$Language = "zh-CN"
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ManagePy = Join-Path $RepoRoot "manage.py"

$PythonCmd = $null
foreach ($cand in @("python", "python3", "py")) {
  $cmd = Get-Command $cand -ErrorAction SilentlyContinue
  if ($cmd) {
    try {
      $ver = & $cand -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>$null
      if ($LASTEXITCODE -eq 0 -and [version]$ver -ge [version]"3.10") {
        $PythonCmd = $cand
        break
      }
    } catch {}
  }
}

if (-not $PythonCmd) {
  Write-Error "Python 3.10+ is required. Activate your Python/Conda environment and retry."
  exit 1
}

$ArgsList = @($ManagePy, "install", "--language", $Language)
if ($SyncDir) { $ArgsList += @("--sync-dir", $SyncDir) }
if ($DeviceName) { $ArgsList += @("--device-name", $DeviceName) }

& $PythonCmd @ArgsList
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "`nRunning initial sync..."
& $PythonCmd $ManagePy sync
