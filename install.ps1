param(
  [string]$SyncDir = "",
  [string]$DeviceName = "",
  [ValidateSet("", "zh-CN", "en", "ja")]
  [string]$Language = "",
  [switch]$NoConda
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ManagePy = Join-Path $RepoRoot "manage.py"
$EnvYml = Join-Path $RepoRoot "environment.yml"
$CondaEnvName = "agy_sync_dashboard"

function Find-CondaExecutable {
  if ($env:CONDA_EXE -and (Test-Path $env:CONDA_EXE)) {
    return $env:CONDA_EXE
  }
  $cmd = Get-Command "conda" -ErrorAction SilentlyContinue
  if ($cmd) {
    return $cmd.Source
  }
  $bases = @(
    "$env:USERPROFILE\miniconda3",
    "$env:USERPROFILE\anaconda3",
    "$env:USERPROFILE\miniforge3",
    "$env:USERPROFILE\mambaforge",
    "$env:LOCALAPPDATA\miniconda3",
    "$env:LOCALAPPDATA\anaconda3",
    "$env:LOCALAPPDATA\miniforge3",
    "C:\ProgramData\miniconda3",
    "C:\ProgramData\anaconda3",
    "D:\miniconda3",
    "D:\anaconda3",
    "D:\conda"
  )
  foreach ($base in $bases) {
    foreach ($rel in @("condabin\conda.bat", "Scripts\conda.exe")) {
      $cand = Join-Path $base $rel
      if (Test-Path $cand) {
        return $cand
      }
    }
  }
  return $null
}

function Find-CondaEnvPython([string]$CondaExe, [string]$EnvName) {
  try {
    $raw = & $CondaExe env list --json 2>$null
    if ($LASTEXITCODE -eq 0 -and $raw) {
      $parsed = $raw | ConvertFrom-Json
      foreach ($envPath in $parsed.envs) {
        if ((Split-Path -Leaf $envPath) -eq $EnvName) {
          $py = Join-Path $envPath "python.exe"
          if (Test-Path $py) {
            return $py
          }
        }
      }
    }
  } catch {}
  return $null
}

$PythonCmd = $null
$CondaExe = if (-not $NoConda) { Find-CondaExecutable } else { $null }

if ($CondaExe) {
  $EnvPython = Find-CondaEnvPython -CondaExe $CondaExe -EnvName $CondaEnvName
  if (-not $EnvPython) {
    Write-Host "Creating isolated Conda environment '$CondaEnvName' from environment.yml..."
    & $CondaExe env create -f $EnvYml -y
    if ($LASTEXITCODE -ne 0) {
      Write-Error "Failed to create Conda environment '$CondaEnvName'."
      exit $LASTEXITCODE
    }
    $EnvPython = Find-CondaEnvPython -CondaExe $CondaExe -EnvName $CondaEnvName
  } else {
    Write-Host "Using isolated Conda environment '$CondaEnvName' ($EnvPython)"
  }
  if ($EnvPython) {
    $PythonCmd = $EnvPython
    $env:CONDA_DEFAULT_ENV = $CondaEnvName
    $env:CONDA_PREFIX = Split-Path -Parent $EnvPython
    $env:AGY_SYNC_NO_CONDA_REEXEC = "1"
  }
}

if (-not $PythonCmd) {
  if (-not $NoConda) {
    Write-Warning "Conda not found; falling back to system Python 3.10+."
  }
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
}

if (-not $PythonCmd) {
  Write-Error "Conda or Python 3.10+ is required. Install Miniconda/Python 3.10+ and retry."
  exit 1
}

$ArgsList = @($ManagePy, "install")
if ($NoConda) { $ArgsList = @($ManagePy, "--no-conda", "install") }
if ($Language) { $ArgsList += @("--language", $Language) }
if ($SyncDir) { $ArgsList += @("--sync-dir", $SyncDir) }
if ($DeviceName) { $ArgsList += @("--device-name", $DeviceName) }

& $PythonCmd @ArgsList
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "`nRunning initial sync..."
if ($NoConda) {
  & $PythonCmd $ManagePy --no-conda sync
} else {
  & $PythonCmd $ManagePy sync
}
