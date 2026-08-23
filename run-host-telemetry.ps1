<# 
.SYNOPSIS
    Runs the SMARAN.AI Host Telemetry Bridge natively on Windows.
    This provides REAL hardware metrics (CPU, GPU, RAM, Disk, Network) to the SMARAN.AI app.
    
.DESCRIPTION
    Docker Desktop on Windows runs containers inside a Linux VM (WSL2).
    The container cannot directly access Windows hardware (GPU, sensors, etc.).
    This script runs the telemetry bridge as a native Windows process,
    which can access Windows WMI, nvidia-smi, and all hardware sensors.
    
    The bridge writes to %LOCALAPPDATA%\SMARAN.AI\telemetry\host_stats.json
    which is mounted into the Docker container by docker-compose.
    
.REQUIREMENTS
    - Python 3.9+ (will be installed via winget if missing)
    - Administrator not required (runs in user context)
    
.USAGE
    .\run-host-telemetry.ps1
    
    To run in background: Start-Process powershell -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `".\run-host-telemetry.ps1`"" -WindowStyle Hidden
#>

param(
    [switch]$InstallOnly,
    [switch]$Stop
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$telemetryRoot = Join-Path ([Environment]::GetFolderPath("LocalApplicationData")) "SMARAN.AI\telemetry"
$bridgeScript = Join-Path $telemetryRoot "host_telemetry_bridge.py"
$bridgeTemporary = Join-Path $telemetryRoot "host_telemetry_bridge.py.new"
$hostStatsFile = Join-Path $telemetryRoot "host_stats.json"
$bridgePidFile = Join-Path $telemetryRoot "bridge.pid"
$bridgeLog = Join-Path $telemetryRoot "bridge.log"
$bridgeErrorLog = Join-Path $telemetryRoot "bridge-error.log"
$bridgeVenv = Join-Path $telemetryRoot "python"
$venvPython = Join-Path $bridgeVenv "Scripts\python.exe"

function Write-Step([string]$Message) {
    Write-Host "  -> $Message" -ForegroundColor Cyan
}

function Write-Ok([string]$Message) {
    Write-Host "  [OK] $Message" -ForegroundColor Green
}

function Write-Warn([string]$Message) {
    Write-Host "  [!] $Message" -ForegroundColor Yellow
}

function Write-Err([string]$Message) {
    Write-Host "  [ERROR] $Message" -ForegroundColor Red
}

function Stop-ExistingBridge {
    if (Test-Path -LiteralPath $bridgePidFile -PathType Leaf) {
        $pidText = (Get-Content -Raw -LiteralPath $bridgePidFile -ErrorAction SilentlyContinue).Trim()
        if ([int]::TryParse($pidText, [ref]$null) -and $pidText -gt 0) {
            try {
                $proc = Get-Process -Id $pidText -ErrorAction SilentlyContinue
                if ($proc -and $proc.Path -like "*python*") {
                    Write-Step "Stopping existing bridge (PID $pidText)..."
                    Stop-Process -Id $pidText -Force -ErrorAction SilentlyContinue
                    Start-Sleep -Milliseconds 500
                }
            } catch {}
        }
    }
}

function ExtractBridgeFromImage {
    Write-Step "Extracting host telemetry bridge from SMARAN.AI image..."
    New-Item -ItemType Directory -Path $telemetryRoot -Force | Out-Null
    
    $extractContainer = docker create shashwatmishra062/smaran-ai:latest 2>$null | Select-Object -Last 1
    if (-not $extractContainer -or $LASTEXITCODE -ne 0) {
        Write-Err "Failed to create extraction container"
        return $false
    }
    
    $extractContainer = $extractContainer.Trim()
    try {
        docker cp "${extractContainer}:/opt/smaran/host_telemetry_bridge.py" $bridgeTemporary | Out-Null
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $bridgeTemporary -PathType Leaf)) {
            Write-Err "Bridge script not found in image"
            return $false
        }
        Move-Item -LiteralPath $bridgeTemporary -Destination $bridgeScript -Force
        Write-Ok "Bridge extracted: $bridgeScript"
        return $true
    } finally {
        docker rm -f $extractContainer 2>$null | Out-Null
        if (Test-Path -LiteralPath $bridgeTemporary) { Remove-Item -LiteralPath $bridgeTemporary -Force -ErrorAction SilentlyContinue }
    }
}

function EnsurePython {
    Write-Step "Checking for Python 3.9+..."
    $py = Get-Command python -ErrorAction SilentlyContinue
    if (-not $py) { $py = Get-Command python3 -ErrorAction SilentlyContinue }
    if (-not $py) { $py = Get-Command py -ErrorAction SilentlyContinue }
    
    if ($py) {
        $ver = & $py.Source -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>$null
        if ($ver -and [version]$ver -ge [version]"3.9") {
            Write-Ok "Found Python $ver at $($py.Source)"
            return @{ Executable = $py.Source; Prefix = @() }
        }
    }
    
    Write-Warn "Python 3.9+ not found. Installing via winget..."
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        Write-Err "winget not available. Please install Python 3.9+ manually from python.org"
        return $null
    }
    
    winget install --id Python.Python.3.12 --exact --scope user --accept-package-agreements --accept-source-agreements --silent --disable-interactivity
    if ($LASTEXITCODE -ne 0) {
        Write-Err "Python installation failed"
        return $null
    }
    
    $env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")
    $py = Get-Command python -ErrorAction SilentlyContinue
    if (-not $py) { $py = Get-Command python3 -ErrorAction SilentlyContinue }
    if ($py) {
        Write-Ok "Installed Python at $($py.Source)"
        return @{ Executable = $py.Source; Prefix = @() }
    }
    return $null
}

function EnsureVenv($pythonSpec) {
    if (-not (Test-Path -LiteralPath $venvPython -PathType Leaf)) {
        Write-Step "Creating isolated Python environment..."
        & $pythonSpec.Executable -m venv $bridgeVenv
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $venvPython -PathType Leaf)) {
            Write-Err "Failed to create virtual environment"
            return $false
        }
    }
    
    Write-Step "Ensuring psutil is installed..."
    & $venvPython -c "import psutil" 2>$null
    if ($LASTEXITCODE -ne 0) {
        & $venvPython -m pip install --disable-pip-version-check --no-input --only-binary=:all: "psutil>=5.9,<8"
        if ($LASTEXITCODE -ne 0) {
            Write-Err "Failed to install psutil"
            return $false
        }
    }
    Write-Ok "Python environment ready"
    return $true
}

function StartBridge {
    Write-Step "Starting host telemetry bridge..."
    $args = @("-u", "`"$bridgeScript`"", "--output", "`"$hostStatsFile`"")
    $proc = Start-Process -FilePath $venvPython -ArgumentList $args -WindowStyle Hidden -RedirectStandardOutput $bridgeLog -RedirectStandardError $bridgeErrorLog -PassThru
    
    [IO.File]::WriteAllText($bridgePidFile, [string]$proc.Id, [Text.UTF8Encoding]::new($false))
    
    for ($i = 1; $i -le 15; $i++) {
        Write-Host "`r  -> Verifying fresh host metrics... $i/15" -NoNewline -ForegroundColor DarkYellow
        Start-Sleep -Seconds 1
        if (Test-FreshHostStats) { 
            Write-Host ""
            Write-Ok "Fresh host telemetry verified (PID $($proc.Id))"
            return $true
        }
        if ($proc.HasExited) { break }
    }
    Write-Host ""
    if ($proc.HasExited) {
        $err = Get-Content -Raw -LiteralPath $bridgeErrorLog -ErrorAction SilentlyContinue
        Write-Err "Bridge process exited. Error: $err"
    } else {
        Write-Warn "Bridge started but metrics not yet fresh. Check $bridgeLog"
    }
    return $false
}

function Test-FreshHostStats {
    if (-not (Test-Path -LiteralPath $hostStatsFile -PathType Leaf)) { return $false }
    try {
        $item = Get-Item -LiteralPath $hostStatsFile
        if (((Get-Date).ToUniversalTime() - $item.LastWriteTimeUtc).TotalSeconds -ge 8) { return $false }
        $payload = Get-Content -Raw -LiteralPath $hostStatsFile | ConvertFrom-Json
        return ($null -ne $payload.timestamp -and $null -ne $payload.cpu_threads -and $null -ne $payload.ram_total_gb)
    } catch { return $false }
}

# Main execution
Write-Host ""
Write-Host "  +--------------------------------------------------------------+" -ForegroundColor Blue
Write-Host "  |     SMARAN.AI Windows Host Telemetry Bridge Runner          |" -ForegroundColor Cyan
Write-Host "  +--------------------------------------------------------------+" -ForegroundColor Blue
Write-Host ""

if ($Stop) {
    Write-Step "Stopping host telemetry bridge..."
    Stop-ExistingBridge
    Write-Ok "Bridge stopped"
    exit 0
}

# Stop any existing bridge
Stop-ExistingBridge

# Extract bridge from image
if (-not (ExtractBridgeFromImage)) {
    # Fallback: check if we already have a bridge
    if (-not (Test-Path -LiteralPath $bridgeScript -PathType Leaf)) {
        Write-Err "Could not extract bridge and no local copy exists"
        exit 1
    }
    Write-Warn "Using previously extracted bridge"
}

# Ensure Python
$pythonSpec = EnsurePython
if (-not $pythonSpec) { exit 1 }

# Ensure venv with psutil
if (-not (EnsureVenv $pythonSpec)) { exit 1 }

if ($InstallOnly) {
    Write-Ok "Installation complete. Run without -InstallOnly to start the bridge."
    exit 0
}

# Start bridge
if (StartBridge) {
    Write-Host ""
    Write-Host "  +--------------------------------------------------------------+" -ForegroundColor Green
    Write-Host "  |  Host Telemetry Bridge is RUNNING                            |" -ForegroundColor Green
    Write-Host "  |  - Writing real hardware metrics to:                         |" -ForegroundColor DarkGray
    Write-Host "  |    $hostStatsFile" -ForegroundColor DarkGray
    Write-Host "  |  - Docker container reads this file via bind mount           |" -ForegroundColor DarkGray
    Write-Host "  |  - GPU, CPU, RAM, Disk, Network will show in SMARAN.AI       |" -ForegroundColor DarkGray
    Write-Host "  +--------------------------------------------------------------+" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Press Ctrl+C to stop the bridge" -ForegroundColor Yellow
    Write-Host ""
    
    try {
        $proc = Get-Process -Id (Get-Content -Raw -LiteralPath $bridgePidFile).Trim() -ErrorAction SilentlyContinue
        if ($proc) { $proc.WaitForExit() }
    } catch {
        Write-Host "Bridge process ended" -ForegroundColor Yellow
    }
} else {
    Write-Err "Failed to start bridge"
    exit 1
}