[CmdletBinding()]
param(
    [int]$Port = 3003,
    [string]$Image = "shashwatmishra062/smaran-ai:latest",
    [string]$ContainerName = "smaran-ai"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "Continue"

function Write-Step([int]$Number, [string]$Title, [string]$Detail) {
    Write-Host ""
    Write-Host ("  [{0}/10] ->  {1}" -f $Number, $Title) -ForegroundColor Cyan
    Write-Host ("           {0}" -f $Detail) -ForegroundColor DarkGray
}

function Write-Ok([string]$Message) { Write-Host ("           [OK] {0}" -f $Message) -ForegroundColor Green }
function Write-Warn([string]$Message) { Write-Host ("           [!]  {0}" -f $Message) -ForegroundColor Yellow }

function Stop-WithHelp([string]$Message, [string]$Recovery) {
    Write-Host ""
    Write-Host ("  [FAILED] {0}" -f $Message) -ForegroundColor Red
    if ($Recovery) { Write-Host ("  -> Recovery: {0}" -f $Recovery) -ForegroundColor Yellow }
    Write-Host "  -> Nothing was reported as ready and the browser was not opened." -ForegroundColor DarkGray
    Read-Host "  Press Enter to close"
    exit 1
}

function Refresh-Path {
    $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$machinePath;$userPath"
}

function Resolve-HostPython {
    $candidates = @()
    $pyLauncher = Get-Command py -ErrorAction SilentlyContinue
    if ($pyLauncher) {
        $candidates += [pscustomobject]@{ Executable = $pyLauncher.Source; Prefix = @("-3") }
    }
    foreach ($commandName in @("python3", "python")) {
        $command = Get-Command $commandName -ErrorAction SilentlyContinue
        if ($command) {
            $candidates += [pscustomobject]@{ Executable = $command.Source; Prefix = @() }
        }
    }
    $localPythonRoot = Join-Path ([Environment]::GetFolderPath("LocalApplicationData")) "Programs\Python"
    if (Test-Path -LiteralPath $localPythonRoot) {
        Get-ChildItem -LiteralPath $localPythonRoot -Filter python.exe -Recurse -ErrorAction SilentlyContinue |
            Sort-Object FullName -Descending |
            ForEach-Object {
                $candidates += [pscustomobject]@{ Executable = $_.FullName; Prefix = @() }
            }
    }
    foreach ($candidate in $candidates) {
        try {
            $testArguments = @($candidate.Prefix) + @("-c", "import sys; raise SystemExit(0 if sys.version_info >= (3, 9) else 1)")
            & $candidate.Executable @testArguments 2>$null
            if ($LASTEXITCODE -eq 0) { return $candidate }
        } catch {}
    }
    return $null
}

function Test-FreshHostStats([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
    try {
        $item = Get-Item -LiteralPath $Path
        if (((Get-Date).ToUniversalTime() - $item.LastWriteTimeUtc).TotalSeconds -ge 8) { return $false }
        $payload = Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json
        return ($null -ne $payload.timestamp -and $null -ne $payload.cpu_threads -and $null -ne $payload.ram_total_gb)
    } catch {
        return $false
    }
}

Clear-Host
Write-Host ""
Write-Host "  +--------------------------------------------------------------+" -ForegroundColor Blue
Write-Host "  |            SMARAN.AI UNIVERSAL WINDOWS LAUNCHER              |" -ForegroundColor Cyan
Write-Host "  |  Docker install -> image pull -> port repair -> health test  |" -ForegroundColor DarkCyan
Write-Host "  +--------------------------------------------------------------+" -ForegroundColor Blue
Write-Host ("  Target: http://localhost:{0}  |  Image: {1}" -f $Port, $Image) -ForegroundColor White

try {
    Write-Step 1 "Checking Windows requirements" "Detecting administrator access, winget, virtualization prerequisites, and port availability."
    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin) {
        Write-Warn "Administrator permission is needed only for Docker Desktop installation."
    }
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    $portOwner = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($portOwner) {
        $ownerProcess = Get-Process -Id $portOwner.OwningProcess -ErrorAction SilentlyContinue
        Write-Warn ("Port {0} is currently used by PID {1} ({2}). It may already be SMARAN.AI." -f $Port, $portOwner.OwningProcess, $ownerProcess.ProcessName)
    } else {
        Write-Ok "Port $Port is available."
    }

    Write-Step 2 "Detecting Docker" "If Docker is absent, Docker Desktop will be installed using the official Windows package manager."
    Refresh-Path
    $docker = Get-Command docker -ErrorAction SilentlyContinue
    if (-not $docker) {
        if (-not $winget) {
            Stop-WithHelp "Docker and winget are both unavailable." "Install App Installer from Microsoft Store, then run this command again."
        }
        if (-not $isAdmin) {
            Write-Warn "Windows will now request Administrator permission; the launcher will resume automatically."
            $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Port $Port -Image `"$Image`" -ContainerName `"$ContainerName`""
            Start-Process powershell.exe -Verb RunAs -ArgumentList $arguments
            exit 0
        }
        Write-Host "           -> Downloading and installing Docker Desktop. Windows may show an installer prompt..." -ForegroundColor Magenta
        & winget install --id Docker.DockerDesktop --exact --accept-package-agreements --accept-source-agreements --silent
        if ($LASTEXITCODE -ne 0) {
            Stop-WithHelp "Docker Desktop installation returned exit code $LASTEXITCODE." "Run: winget install --id Docker.DockerDesktop --exact"
        }
        Refresh-Path
        $docker = Get-Command docker -ErrorAction SilentlyContinue
        if (-not $docker) {
            $dockerCli = "C:\Program Files\Docker\Docker\resources\bin\docker.exe"
            if (Test-Path $dockerCli) { $env:Path += ";C:\Program Files\Docker\Docker\resources\bin" }
        }
        Write-Ok "Docker Desktop installation completed."
    } else {
        Write-Ok ("Docker CLI detected at {0}." -f $docker.Source)
    }

    Write-Step 3 "Starting Docker Engine" "Live checks run every 3 seconds; first startup can take several minutes."
    $desktopPath = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    if (-not (docker info 2>$null)) {
        if (Test-Path $desktopPath) {
            if (-not (Get-Process "Docker Desktop" -ErrorAction SilentlyContinue)) {
                Start-Process -FilePath $desktopPath
                Write-Host "           -> Docker Desktop launched." -ForegroundColor Magenta
            }
        }
        $engineReady = $false
        for ($attempt = 1; $attempt -le 100; $attempt++) {
            $seconds = $attempt * 3
            Write-Host ("`r           -> Waiting for Docker Engine... {0}s / 300s   " -f $seconds) -NoNewline -ForegroundColor DarkYellow
            Start-Sleep -Seconds 3
            if (docker info 2>$null) { $engineReady = $true; break }
        }
        Write-Host ""
        if (-not $engineReady) {
            Stop-WithHelp "Docker Engine did not become ready within 5 minutes." "Open Docker Desktop, finish its WSL/terms setup, then run this command again. A Windows restart may be required after first install."
        }
    }
    Write-Ok "Docker Engine is online."

    Write-Step 4 "Preparing a private local AI starter" "Starting official Ollama on an app-only Docker network and preserving its model volume across upgrades."
    $ollamaImage = "ollama/ollama:latest"
    $starterModel = "qwen2.5:1.5b"
    $ollamaContainerName = "smaran-ollama"
    $ollamaNetworkName = "smaran-ai-local"
    $ollamaVolumeName = "smaran-ai-ollama-models"
    $ollamaRuntimeReady = $false
    $starterModelReady = $false
    $ollamaNetworkReady = $false
    $skipStarterModel = ($env:SMARAN_SKIP_STARTER_MODEL -match '^(1|true|yes)$')
    Write-Host "           -> Starter: qwen2.5:1.5b, Q4_K_M, 986 MB model data, Apache-2.0." -ForegroundColor White
    Write-Host "           -> CPU-only inference uses additional RAM and can be slower. This small starter is not a quality or speed guarantee." -ForegroundColor DarkGray
    Write-Host "           -> Ollama port 11434 stays private; only containers on the SMARAN.AI network can reach it." -ForegroundColor DarkGray
    Write-Host "           -> Set SMARAN_SKIP_STARTER_MODEL=1 before launch to opt out of the local runtime and model download." -ForegroundColor DarkGray

    if ($skipStarterModel) {
        Write-Warn "Starter runtime/model setup was explicitly skipped. The app may require manual model or cloud-provider setup."
    } else {
        & docker network inspect $ollamaNetworkName 2>$null | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-Host "           -> Creating the private SMARAN.AI Docker network..." -ForegroundColor Magenta
            & docker network create --label "ai.smaran.role=local-ai" $ollamaNetworkName | Out-Null
        }
        $ollamaNetworkReady = ($LASTEXITCODE -eq 0)
        if (-not $ollamaNetworkReady) { Write-Warn "The app-only Docker network could not be prepared." }

        & docker volume inspect $ollamaVolumeName 2>$null | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-Host "           -> Creating the persistent Ollama model volume..." -ForegroundColor Magenta
            & docker volume create --label "ai.smaran.role=ollama-models" $ollamaVolumeName | Out-Null
        }
        $ollamaVolumeReady = ($LASTEXITCODE -eq 0)
        if (-not $ollamaVolumeReady) { Write-Warn "The persistent Ollama model volume could not be prepared." }

        $existingOllamaId = ([string](& docker ps -aq --filter "name=^/$ollamaContainerName$" 2>$null)).Trim()
        $ollamaCandidateReady = $false
        if ($existingOllamaId) {
            $existingOllamaImage = ([string](& docker inspect --format '{{.Config.Image}}' $ollamaContainerName 2>$null)).Trim()
            if ($existingOllamaImage -notmatch '^ollama/ollama(?::|@|$)') {
                Write-Warn "Container '$ollamaContainerName' exists but is not based on official ollama/ollama. It was preserved and will not be trusted or replaced."
            } elseif ($ollamaNetworkReady) {
                $ollamaRunning = (([string](& docker inspect --format '{{.State.Running}}' $ollamaContainerName 2>$null)).Trim() -eq "true")
                if (-not $ollamaRunning) {
                    Write-Host "           -> Starting the preserved official Ollama container..." -ForegroundColor Magenta
                    & docker start $ollamaContainerName | Out-Null
                    $ollamaRunning = ($LASTEXITCODE -eq 0)
                }
                if ($ollamaRunning) {
                    $networkMembers = @(& docker network inspect --format '{{range .Containers}}{{println .Name}}{{end}}' $ollamaNetworkName 2>$null)
                    if ($networkMembers -notcontains $ollamaContainerName) {
                        & docker network connect $ollamaNetworkName $ollamaContainerName 2>$null
                    }
                    $ollamaCandidateReady = ($LASTEXITCODE -eq 0)
                    if ($ollamaCandidateReady) { Write-Ok "Preserved official Ollama container and its existing models." }
                }
            }
        } elseif ($ollamaNetworkReady -and $ollamaVolumeReady) {
            Write-Host "           -> Pulling official ollama/ollama; Docker layer progress follows..." -ForegroundColor Magenta
            & docker pull $ollamaImage
            if ($LASTEXITCODE -eq 0) {
                & docker run -d --name $ollamaContainerName --restart unless-stopped --network $ollamaNetworkName -v "${ollamaVolumeName}:/root/.ollama" --label "ai.smaran.role=ollama" $ollamaImage | Out-Null
                $ollamaCandidateReady = ($LASTEXITCODE -eq 0)
            } else {
                Write-Warn "The official Ollama image could not be downloaded."
            }
        }

        if ($ollamaCandidateReady) {
            for ($attempt = 1; $attempt -le 45; $attempt++) {
                Write-Host ("`r           -> Waiting for private Ollama API... {0}/45   " -f $attempt) -NoNewline -ForegroundColor DarkYellow
                & docker exec $ollamaContainerName ollama list 2>$null | Out-Null
                if ($LASTEXITCODE -eq 0) { $ollamaRuntimeReady = $true; break }
                Start-Sleep -Seconds 1
            }
            Write-Host ""
        }

        if ($ollamaRuntimeReady) {
            $installedModels = (& docker exec $ollamaContainerName ollama list 2>$null) -join "`n"
            $starterModelReady = ($installedModels -match '(?m)^\s*qwen2\.5:1\.5b\s')
            if ($starterModelReady) {
                Write-Ok "Starter model is already installed; no model data was re-downloaded."
            } else {
                Write-Host "           -> Pulling qwen2.5:1.5b now; Ollama prints live model progress below..." -ForegroundColor Magenta
                & docker exec $ollamaContainerName ollama pull $starterModel
                if ($LASTEXITCODE -eq 0) {
                    $installedModels = (& docker exec $ollamaContainerName ollama list 2>$null) -join "`n"
                    $starterModelReady = ($installedModels -match '(?m)^\s*qwen2\.5:1\.5b\s')
                }
            }
        }
        if ($starterModelReady) {
            Write-Ok "Ollama is reachable and qwen2.5:1.5b is installed; no response-quality or speed claim is implied."
        } elseif ($ollamaRuntimeReady) {
            Write-Warn "Ollama is running, but the starter model pull did not complete. SMARAN.AI will show that model setup is required."
        } else {
            Write-Warn "The private Ollama runtime did not become ready. SMARAN.AI will continue without claiming a local model."
        }
    }

    Write-Step 5 "Downloading latest SMARAN.AI" "Docker will print real layer-by-layer download progress below. Cached layers are reused."
    & docker pull $Image
    if ($LASTEXITCODE -ne 0) {
        Stop-WithHelp "The Docker image could not be downloaded." "Check internet access and run: docker pull $Image"
    }
    Write-Ok "Latest image is available locally."

    Write-Step 6 "Connecting verified host telemetry" "Extracting the bridge from this image, preparing an isolated Python environment, and waiting for fresh device metrics."
    $telemetryReady = $false
    $telemetryMounted = $false
    $telemetryRoot = Join-Path ([Environment]::GetFolderPath("LocalApplicationData")) "SMARAN.AI\telemetry"
    $bridgeScript = Join-Path $telemetryRoot "host_telemetry_bridge.py"
    $bridgeTemporary = Join-Path $telemetryRoot "host_telemetry_bridge.py.new"
    $hostStatsFile = Join-Path $telemetryRoot "host_stats.json"
    $bridgePidFile = Join-Path $telemetryRoot "bridge.pid"
    $bridgeLog = Join-Path $telemetryRoot "bridge.log"
    $bridgeErrorLog = Join-Path $telemetryRoot "bridge-error.log"
    $bridgeVenv = Join-Path $telemetryRoot "python"
    $venvPython = Join-Path $bridgeVenv "Scripts\python.exe"

    New-Item -ItemType Directory -Path $telemetryRoot -Force | Out-Null
    if (-not (Test-Path -LiteralPath $hostStatsFile -PathType Leaf)) {
        [IO.File]::WriteAllText($hostStatsFile, "{}", [Text.UTF8Encoding]::new($false))
    }
    Write-Host ("           -> Private telemetry directory: {0}" -f $telemetryRoot) -ForegroundColor DarkGray

    $extractContainer = $null
    $bridgeUpdated = $false
    try {
        Write-Host "           -> Extracting the matching host bridge from the downloaded image..." -ForegroundColor Magenta
        $extractContainer = (& docker create $Image 2>$null | Select-Object -Last 1).Trim()
        if (-not $extractContainer -or $LASTEXITCODE -ne 0) { throw "Docker could not create the temporary extraction container." }
        & docker cp "${extractContainer}:/opt/smaran/host_telemetry_bridge.py" $bridgeTemporary | Out-Null
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $bridgeTemporary -PathType Leaf)) {
            throw "This image does not contain /opt/smaran/host_telemetry_bridge.py."
        }
        Move-Item -LiteralPath $bridgeTemporary -Destination $bridgeScript -Force
        $bridgeUpdated = $true
        Write-Ok "Host bridge extracted from the same image version."
    } catch {
        Write-Warn ("Bridge extraction was unavailable: {0}" -f $_.Exception.Message)
        if (Test-Path -LiteralPath $bridgeScript -PathType Leaf) {
            Write-Warn "A previously extracted bridge exists and will be validated before use."
        }
    } finally {
        if ($extractContainer) { & docker rm -f $extractContainer 2>$null | Out-Null }
        if (Test-Path -LiteralPath $bridgeTemporary) { Remove-Item -LiteralPath $bridgeTemporary -Force -ErrorAction SilentlyContinue }
    }

    $existingBridgeProcess = $null
    if (Test-Path -LiteralPath $bridgePidFile -PathType Leaf) {
        $oldBridgePid = 0
        $pidText = (Get-Content -Raw -LiteralPath $bridgePidFile -ErrorAction SilentlyContinue).Trim()
        if ([int]::TryParse($pidText, [ref]$oldBridgePid) -and $oldBridgePid -gt 0) {
            $candidateProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $oldBridgePid" -ErrorAction SilentlyContinue
            if ($candidateProcess -and $candidateProcess.CommandLine -and
                $candidateProcess.CommandLine.IndexOf($bridgeScript, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
                $existingBridgeProcess = $candidateProcess
            }
        }
    }
    if ($existingBridgeProcess -and (Test-FreshHostStats $hostStatsFile) -and -not $bridgeUpdated) {
        $telemetryReady = $true
        Write-Ok ("Existing host bridge is healthy (PID {0})." -f $existingBridgeProcess.ProcessId)
    } elseif ($existingBridgeProcess) {
        if ($bridgeUpdated) {
            Write-Host ("           -> Restarting the verified bridge process (PID {0}) with the downloaded image version..." -f $existingBridgeProcess.ProcessId) -ForegroundColor Magenta
        } else {
            Write-Warn ("The previous bridge process (PID {0}) is stale; restarting only this verified SMARAN.AI process." -f $existingBridgeProcess.ProcessId)
        }
        Stop-Process -Id $existingBridgeProcess.ProcessId -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 500
    }

    if (-not $telemetryReady -and (Test-Path -LiteralPath $bridgeScript -PathType Leaf)) {
        $pythonSpec = Resolve-HostPython
        if (-not $pythonSpec -and $winget) {
            Write-Warn "Python 3.9+ is absent. Installing an isolated user-scoped Python runtime with winget for real host telemetry."
            & winget install --id Python.Python.3.12 --exact --scope user --accept-package-agreements --accept-source-agreements --silent --disable-interactivity
            if ($LASTEXITCODE -eq 0) {
                Refresh-Path
                $pythonSpec = Resolve-HostPython
            } else {
                Write-Warn ("Python installation returned exit code {0}." -f $LASTEXITCODE)
            }
        }

        if ($pythonSpec) {
            if (-not (Test-Path -LiteralPath $venvPython -PathType Leaf)) {
                Write-Host "           -> Creating an app-only Python environment; system packages remain untouched..." -ForegroundColor Magenta
                $venvArguments = @($pythonSpec.Prefix) + @("-m", "venv", $bridgeVenv)
                & $pythonSpec.Executable @venvArguments
            }
            if (Test-Path -LiteralPath $venvPython -PathType Leaf) {
                & $venvPython -c "import psutil" 2>$null
                if ($LASTEXITCODE -ne 0) {
                    Write-Host "           -> Installing psutil into the app-only environment (binary package only)..." -ForegroundColor Magenta
                    & $venvPython -m pip install --disable-pip-version-check --no-input --only-binary=:all: "psutil>=5.9,<8"
                }
                & $venvPython -c "import psutil" 2>$null
                if ($LASTEXITCODE -eq 0) {
                    Write-Host "           -> Starting the host bridge in the background..." -ForegroundColor Magenta
                    $bridgeLaunchArguments = @("-u", "`"$bridgeScript`"", "--output", "`"$hostStatsFile`"")
                    $bridgeProcess = Start-Process -FilePath $venvPython -ArgumentList $bridgeLaunchArguments -WindowStyle Hidden -RedirectStandardOutput $bridgeLog -RedirectStandardError $bridgeErrorLog -PassThru
                    [IO.File]::WriteAllText($bridgePidFile, [string]$bridgeProcess.Id, [Text.UTF8Encoding]::new($false))
                    for ($attempt = 1; $attempt -le 12; $attempt++) {
                        Write-Host ("`r           -> Verifying fresh host metrics... {0}/12   " -f $attempt) -NoNewline -ForegroundColor DarkYellow
                        Start-Sleep -Seconds 1
                        if (Test-FreshHostStats $hostStatsFile) { $telemetryReady = $true; break }
                        if ($bridgeProcess.HasExited) { break }
                    }
                    Write-Host ""
                    if ($telemetryReady) {
                        Write-Ok ("Fresh host telemetry verified from PID {0}." -f $bridgeProcess.Id)
                    } else {
                        if (-not $bridgeProcess.HasExited) { Stop-Process -Id $bridgeProcess.Id -Force -ErrorAction SilentlyContinue }
                        Write-Warn ("The bridge did not produce valid fresh metrics. Details: {0}" -f $bridgeErrorLog)
                    }
                } else {
                    Write-Warn "psutil could not be provisioned in the isolated environment."
                }
            } else {
                Write-Warn "The isolated Python environment could not be created."
            }
        } else {
            Write-Warn "Python 3.9+ is unavailable, so the host bridge cannot run."
        }
    }
    if (-not $telemetryReady) {
        [IO.File]::WriteAllText($hostStatsFile, "{}", [Text.UTF8Encoding]::new($false))
        Write-Warn "Host telemetry is unavailable. SMARAN.AI will explicitly fall back to Docker container runtime metrics; no host values are guessed."
    }

    Write-Step 7 "Repairing container and port mapping" "Any old SMARAN.AI container is replaced so localhost:$Port is always published. Persistent data and downloaded models remain in named volumes."
    $existingId = docker ps -aq --filter "name=^/$ContainerName$" 2>$null
    if ($existingId) {
        $currentPort = docker inspect --format '{{(index (index .NetworkSettings.Ports "3003/tcp") 0).HostPort}}' $ContainerName 2>$null
        if ($currentPort -eq "$Port") {
            Write-Host "           -> Existing container already maps port $Port; recreating it with the latest image." -ForegroundColor DarkGray
        } else {
            Write-Warn ("Existing container has missing/wrong port mapping ('{0}'). Recreating it now." -f ($currentPort | Out-String).Trim())
        }
        & docker rm -f $ContainerName | Out-Null
    }

    $conflict = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($conflict) {
        Stop-WithHelp "Port $Port is occupied by PID $($conflict.OwningProcess), so Docker cannot publish it." "Close that application or rerun with another port, for example: -Port 3004"
    }

    $baseRunArguments = @("run", "-d", "--name", $ContainerName, "--restart", "unless-stopped", "-p", "${Port}:3003", "-v", "smaran_data:/app/data", "-e", "SMARAN_IMAGE=$Image", "-e", "DATA_DIR=/app/data", "-e", "HF_HOME=/app/data/models", "-e", "HUGGINGFACE_HUB_CACHE=/app/data/models/hub")
    if ($ollamaRuntimeReady) {
        $baseRunArguments += @("--network", $ollamaNetworkName, "-e", "OLLAMA_URL=http://${ollamaContainerName}:11434", "-e", "INFERENCE_ENGINE=ollama")
    }
    if ($starterModelReady) {
        $baseRunArguments += @("-e", "ACTIVE_MODEL=$starterModel")
    }
    $runArguments = @($baseRunArguments)
    if ($telemetryReady) {
        $runArguments += @("--mount", "type=bind,source=$hostStatsFile,target=/app/data/host_stats.json,readonly")
    }
    $runArguments += $Image
    & docker @runArguments | Out-Null
    if ($LASTEXITCODE -ne 0 -and $telemetryReady) {
        Write-Warn "Docker could not bind the verified host telemetry file. Retrying safely with container runtime telemetry."
        & docker rm -f $ContainerName 2>$null | Out-Null
        $telemetryReady = $false
        $runArguments = @($baseRunArguments) + @($Image)
        & docker @runArguments | Out-Null
    }
    if ($LASTEXITCODE -ne 0) {
        Stop-WithHelp "Container creation failed." "Run: docker logs $ContainerName"
    }
    $published = docker port $ContainerName 3003/tcp 2>$null
    if (-not ($published -match ":$Port$")) {
        Stop-WithHelp "Docker started the container but did not publish port $Port." "Run: docker inspect $ContainerName"
    }
    Write-Ok ("Verified Docker mapping: {0}" -f ($published -join ", "))

    if ($telemetryReady) {
        & docker exec $ContainerName python -c "import json,time; p='/app/data/host_stats.json'; d=json.load(open(p)); raise SystemExit(0 if time.time()-float(d.get('timestamp',0)) < 8 else 1)" 2>$null
        if ($LASTEXITCODE -eq 0) {
            $telemetryMounted = $true
            Write-Ok "Read-only host_stats.json mount is visible inside SMARAN.AI."
        } else {
            $telemetryReady = $false
            Write-Warn "The host bridge is running, but the container cannot read its mount. The app will use container runtime telemetry."
        }
    }

    Write-Step 8 "Watching application startup" "Container logs are sampled while the FastAPI health endpoint initializes."
    $url = "http://localhost:$Port"
    $healthUrl = "$url/api/test/ping"
    $healthy = $false
    for ($attempt = 1; $attempt -le 120; $attempt++) {
        try {
            $response = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 3
            if ($response.status -eq "ok") { $healthy = $true; break }
        } catch {}
        if (($attempt % 5) -eq 0) {
            $status = docker inspect --format '{{.State.Status}}' $ContainerName 2>$null
            $lastLog = docker logs --tail 1 $ContainerName 2>&1
            Write-Host ("           -> {0}s | container={1} | {2}" -f ($attempt * 2), $status, ($lastLog | Select-Object -Last 1)) -ForegroundColor DarkYellow
        } else {
            Write-Host ("`r           -> Health check {0}/120...   " -f $attempt) -NoNewline -ForegroundColor DarkGray
        }
        Start-Sleep -Seconds 2
    }
    Write-Host ""
    if (-not $healthy) {
        Write-Host "  ---------------- LAST CONTAINER LOGS ----------------" -ForegroundColor Yellow
        docker logs --tail 40 $ContainerName
        Stop-WithHelp "SMARAN.AI did not pass its health check within 4 minutes." "Review the logs above, then run: docker restart $ContainerName"
    }
    Write-Ok "Health endpoint returned status=ok."

    Write-Step 9 "Final verification" "Checking running state, local-model status, telemetry source, and browser URL before reporting success."
    docker ps --filter "name=^/$ContainerName$" --format "           -> {{.Names}} | {{.Status}} | {{.Ports}}"
    if ($telemetryMounted) {
        Write-Ok "Telemetry source: verified Windows host bridge (read-only mount)."
    } else {
        Write-Warn "Telemetry source: Docker container runtime fallback."
    }
    if ($starterModelReady) {
        Write-Ok "Local AI source: private Ollama reachable; qwen2.5:1.5b installed (CPU starter)."
    } else {
        Write-Warn "Local AI source: model setup required; no starter model is being claimed as ready."
    }
    Write-Ok "SMARAN.AI is reachable at $url"

    Write-Step 10 "Opening SMARAN.AI" "The default browser opens only after the server is verified healthy."
    Start-Process $url
    Write-Host ""
    Write-Host "  +--------------------------------------------------------------+" -ForegroundColor Green
    Write-Host "  |  READY: SMARAN.AI is running locally                         |" -ForegroundColor Green
    Write-Host ("  |  URL: {0,-54}|" -f $url) -ForegroundColor White
    Write-Host "  |  Stop later: docker stop smaran-ai                            |" -ForegroundColor DarkGray
    Write-Host "  |  Start later: docker start smaran-ai                          |" -ForegroundColor DarkGray
    Write-Host "  +--------------------------------------------------------------+" -ForegroundColor Green
    Read-Host "  Press Enter to close this launcher (SMARAN.AI keeps running)"
} catch {
    Stop-WithHelp $_.Exception.Message "Copy the red error and the preceding step output; no hidden failure was suppressed."
}
