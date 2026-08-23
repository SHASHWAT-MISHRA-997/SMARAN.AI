#!/usr/bin/env sh
set -u

PORT="${SMARAN_PORT:-3003}"
IMAGE="${SMARAN_IMAGE:-shashwatmishra062/smaran-ai:latest}"
CONTAINER="${SMARAN_CONTAINER:-smaran-ai}"
OS="$(uname -s 2>/dev/null || printf unknown)"

step() { printf '\n\033[1;36m  [%s/10] ->  %s\033[0m\n\033[2m           %s\033[0m\n' "$1" "$2" "$3"; }
ok() { printf '\033[1;32m           [OK] %s\033[0m\n' "$1"; }
warn() { printf '\033[1;33m           [!]  %s\033[0m\n' "$1"; }
fail() {
  printf '\n\033[1;31m  [FAILED] %s\033[0m\n' "$1" >&2
  [ -n "${2:-}" ] && printf '\033[1;33m  -> Recovery: %s\033[0m\n' "$2" >&2
  printf '\033[2m  -> Nothing was reported as ready and the browser was not opened.\033[0m\n' >&2
  exit 1
}
have() { command -v "$1" >/dev/null 2>&1; }
dockerx() {
  if [ "${USE_SUDO_DOCKER:-0}" -eq 1 ]; then sudo docker "$@"; else docker "$@"; fi
}
docker_ready() { dockerx info >/dev/null 2>&1; }
port_busy() {
  if have lsof; then lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1
  elif have ss; then ss -ltn 2>/dev/null | grep -q ":$PORT "
  elif have netstat; then netstat -an 2>/dev/null | grep -q "[.:]$PORT .*LISTEN"
  else return 1
  fi
}
rootx() {
  if [ "$(id -u)" -eq 0 ]; then "$@"
  elif have sudo; then sudo "$@"
  else return 127
  fi
}
find_python() {
  for candidate in python3 python; do
    if have "$candidate" && "$candidate" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 9) else 1)' >/dev/null 2>&1; then
      command -v "$candidate"
      return 0
    fi
  done
  return 1
}
stats_fresh() {
  [ -s "$HOST_STATS_FILE" ] || return 1
  now="$(date +%s 2>/dev/null || printf 0)"
  if [ "$PLATFORM" = macos ]; then
    modified="$(stat -f %m "$HOST_STATS_FILE" 2>/dev/null || printf 0)"
  else
    modified="$(stat -c %Y "$HOST_STATS_FILE" 2>/dev/null || printf 0)"
  fi
  age=$((now - modified))
  [ "$age" -ge 0 ] && [ "$age" -lt 8 ] && grep -q '"timestamp"' "$HOST_STATS_FILE" 2>/dev/null
}
owned_bridge_running() {
  [ -n "${OLD_BRIDGE_PID:-}" ] || return 1
  case "$OLD_BRIDGE_PID" in *[!0-9]*|'') return 1 ;; esac
  kill -0 "$OLD_BRIDGE_PID" 2>/dev/null || return 1
  bridge_command="$(ps -p "$OLD_BRIDGE_PID" -o command= 2>/dev/null || true)"
  case "$bridge_command" in *"$BRIDGE_SCRIPT"*) return 0 ;; *) return 1 ;; esac
}

clear 2>/dev/null || true
printf '\n\033[1;34m  +--------------------------------------------------------------+\033[0m\n'
printf '\033[1;36m  |       SMARAN.AI UNIVERSAL macOS / LINUX LAUNCHER            |\033[0m\n'
printf '\033[36m  | Docker install -> image pull -> port repair -> health test  |\033[0m\n'
printf '\033[1;34m  +--------------------------------------------------------------+\033[0m\n'
printf '  Platform: %s | URL: http://localhost:%s\n' "$OS" "$PORT"

step 1 "Checking platform requirements" "Detecting operating system, privileges, download tools, and port availability."
case "$OS" in
  Darwin) PLATFORM=macos ;;
  Linux) PLATFORM=linux ;;
  *) fail "Unsupported POSIX platform: $OS" "Use install-smaran.ps1 on native Windows PowerShell." ;;
esac
USE_SUDO_DOCKER=0
if [ "$PLATFORM" = linux ] && [ "$(id -u)" -ne 0 ]; then
  if have docker && docker info >/dev/null 2>&1; then
    USE_SUDO_DOCKER=0
  elif have sudo; then
    USE_SUDO_DOCKER=1
  fi
fi
if port_busy; then warn "Port $PORT is currently occupied. It may already be SMARAN.AI."; else ok "Port $PORT is available."; fi

step 2 "Detecting Docker" "Docker will be installed only when its CLI is missing."
if ! have docker; then
  if [ "$PLATFORM" = macos ]; then
    if ! have brew; then
      have curl || fail "Docker, Homebrew, and curl are unavailable." "Install Docker Desktop from https://docs.docker.com/desktop/setup/install/mac-install/"
      have /bin/bash || fail "The macOS Bash runtime is unavailable." "Install Docker Desktop manually from Docker's official documentation."
      warn "Homebrew is missing. The official Homebrew installer will run first and may request the macOS administrator password."
      brew_script="$(mktemp)" || fail "Could not create a temporary Homebrew installer." "Check temporary-directory permissions."
      trap 'rm -f "$brew_script"' EXIT INT TERM
      curl -fL --retry 3 https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh -o "$brew_script" || fail "Official Homebrew installer download failed." "Check internet access and https://brew.sh"
      NONINTERACTIVE=1 /bin/bash "$brew_script" || fail "Homebrew installation failed." "Review the visible installer output above or install Docker Desktop manually."
      rm -f "$brew_script"
      trap - EXIT INT TERM
      if [ -x /opt/homebrew/bin/brew ]; then
        PATH="/opt/homebrew/bin:$PATH"
      elif [ -x /usr/local/bin/brew ]; then
        PATH="/usr/local/bin:$PATH"
      fi
      have brew || fail "Homebrew installed but is not available in this terminal." "Open a new Terminal and run the SMARAN.AI command again."
    fi
    printf '           -> Installing Docker Desktop with Homebrew Cask...\n'
    brew install --cask docker || fail "Docker Desktop installation failed." "Run: brew install --cask docker"
  else
    have curl || fail "curl is required to install Docker Engine." "Install curl with your Linux package manager."
    warn "Linux Docker installation requires sudo and will use Docker's official get.docker.com installer."
    tmp_script="$(mktemp)" || fail "Could not create a temporary installer file." "Check temporary-directory permissions."
    trap 'rm -f "$tmp_script"' EXIT INT TERM
    curl -fL --retry 3 https://get.docker.com -o "$tmp_script" || fail "Official Docker installer download failed." "Check internet access and https://get.docker.com"
    rootx sh "$tmp_script" || fail "Docker Engine installation failed." "Review the installer output above."
    rm -f "$tmp_script"
    trap - EXIT INT TERM
  fi
else
  ok "Docker CLI detected at $(command -v docker)."
fi

step 3 "Starting Docker Engine" "Live checks run every 3 seconds; first startup can take several minutes."
if ! docker_ready; then
  if [ "$PLATFORM" = macos ]; then
    open -a Docker || fail "Docker Desktop could not be launched." "Open Docker from Applications and finish its first-run setup."
  else
    if have systemctl; then
      rootx systemctl enable --now docker || fail "Docker service could not be started." "Run: sudo systemctl status docker"
    elif have service; then
      rootx service docker start || fail "Docker service could not be started." "Start the Docker daemon for your Linux distribution."
    else
      fail "No supported service manager was found." "Start dockerd manually, then rerun this installer."
    fi
  fi
  attempt=1
  while [ "$attempt" -le 100 ]; do
    seconds=$((attempt * 3))
    printf '\r           -> Waiting for Docker Engine... %ss / 300s   ' "$seconds"
    sleep 3
    if docker_ready; then break; fi
    attempt=$((attempt + 1))
  done
  printf '\n'
  docker_ready || fail "Docker Engine did not become ready within 5 minutes." "Open Docker Desktop/service, finish setup, then rerun."
fi
ok "Docker Engine is online."

step 4 "Preparing a private local AI starter" "Starting official Ollama on an app-only Docker network and preserving its model volume across upgrades."
OLLAMA_IMAGE="ollama/ollama:latest"
STARTER_MODEL="qwen2.5:1.5b"
OLLAMA_CONTAINER="smaran-ollama"
OLLAMA_NETWORK="smaran-ai-local"
OLLAMA_VOLUME="smaran-ai-ollama-models"
OLLAMA_RUNTIME_READY=0
STARTER_MODEL_READY=0
OLLAMA_NETWORK_READY=0
printf '           -> Starter: qwen2.5:1.5b, Q4_K_M, 986 MB model data, Apache-2.0.\n'
printf '           -> CPU-only inference uses additional RAM and can be slower. This small starter is not a quality or speed guarantee.\n'
printf '           -> Ollama port 11434 stays private; only containers on the SMARAN.AI network can reach it.\n'
printf '           -> Set SMARAN_SKIP_STARTER_MODEL=1 before launch to opt out of the local runtime and model download.\n'

case "${SMARAN_SKIP_STARTER_MODEL:-0}" in
  1|true|TRUE|yes|YES)
    warn "Starter runtime/model setup was explicitly skipped. The app may require manual model or cloud-provider setup."
    ;;
  *)
    if dockerx network inspect "$OLLAMA_NETWORK" >/dev/null 2>&1; then
      OLLAMA_NETWORK_READY=1
    else
      printf '           -> Creating the private SMARAN.AI Docker network...\n'
      if dockerx network create --label ai.smaran.role=local-ai "$OLLAMA_NETWORK" >/dev/null; then OLLAMA_NETWORK_READY=1
      else warn "The app-only Docker network could not be prepared."
      fi
    fi

    OLLAMA_VOLUME_READY=0
    if dockerx volume inspect "$OLLAMA_VOLUME" >/dev/null 2>&1; then
      OLLAMA_VOLUME_READY=1
    else
      printf '           -> Creating the persistent Ollama model volume...\n'
      if dockerx volume create --label ai.smaran.role=ollama-models "$OLLAMA_VOLUME" >/dev/null; then OLLAMA_VOLUME_READY=1
      else warn "The persistent Ollama model volume could not be prepared."
      fi
    fi

    OLLAMA_CANDIDATE_READY=0
    EXISTING_OLLAMA="$(dockerx ps -aq --filter "name=^/${OLLAMA_CONTAINER}$" 2>/dev/null || true)"
    if [ -n "$EXISTING_OLLAMA" ]; then
      EXISTING_OLLAMA_IMAGE="$(dockerx inspect --format '{{.Config.Image}}' "$OLLAMA_CONTAINER" 2>/dev/null || true)"
      case "$EXISTING_OLLAMA_IMAGE" in
        ollama/ollama|ollama/ollama:*|ollama/ollama@*)
          OLLAMA_RUNNING="$(dockerx inspect --format '{{.State.Running}}' "$OLLAMA_CONTAINER" 2>/dev/null || printf false)"
          if [ "$OLLAMA_RUNNING" != true ]; then
            printf '           -> Starting the preserved official Ollama container...\n'
            if dockerx start "$OLLAMA_CONTAINER" >/dev/null; then OLLAMA_RUNNING=true; fi
          fi
          if [ "$OLLAMA_RUNNING" = true ] && [ "$OLLAMA_NETWORK_READY" -eq 1 ]; then
            if ! dockerx network inspect --format '{{range .Containers}}{{println .Name}}{{end}}' "$OLLAMA_NETWORK" 2>/dev/null | grep -qx "$OLLAMA_CONTAINER"; then
              dockerx network connect "$OLLAMA_NETWORK" "$OLLAMA_CONTAINER" >/dev/null 2>&1 || true
            fi
            if dockerx network inspect --format '{{range .Containers}}{{println .Name}}{{end}}' "$OLLAMA_NETWORK" 2>/dev/null | grep -qx "$OLLAMA_CONTAINER"; then
              OLLAMA_CANDIDATE_READY=1
              ok "Preserved official Ollama container and its existing models."
            fi
          fi
          ;;
        *) warn "Container '$OLLAMA_CONTAINER' exists but is not official ollama/ollama. It was preserved and will not be trusted or replaced." ;;
      esac
    elif [ "$OLLAMA_NETWORK_READY" -eq 1 ] && [ "$OLLAMA_VOLUME_READY" -eq 1 ]; then
      printf '           -> Pulling official ollama/ollama; Docker layer progress follows...\n'
      if dockerx pull "$OLLAMA_IMAGE"; then
        if dockerx run -d --name "$OLLAMA_CONTAINER" --restart unless-stopped --network "$OLLAMA_NETWORK" -v "$OLLAMA_VOLUME:/root/.ollama" --label ai.smaran.role=ollama "$OLLAMA_IMAGE" >/dev/null; then
          OLLAMA_CANDIDATE_READY=1
        fi
      else
        warn "The official Ollama image could not be downloaded."
      fi
    fi

    if [ "$OLLAMA_CANDIDATE_READY" -eq 1 ]; then
      ollama_attempt=1
      while [ "$ollama_attempt" -le 45 ]; do
        printf '\r           -> Waiting for private Ollama API... %s/45   ' "$ollama_attempt"
        if dockerx exec "$OLLAMA_CONTAINER" ollama list >/dev/null 2>&1; then OLLAMA_RUNTIME_READY=1; break; fi
        sleep 1
        ollama_attempt=$((ollama_attempt + 1))
      done
      printf '\n'
    fi

    if [ "$OLLAMA_RUNTIME_READY" -eq 1 ]; then
      if dockerx exec "$OLLAMA_CONTAINER" ollama list 2>/dev/null | awk 'NR > 1 {print $1}' | grep -qx "$STARTER_MODEL"; then
        STARTER_MODEL_READY=1
        ok "Starter model is already installed; no model data was re-downloaded."
      else
        printf '           -> Pulling qwen2.5:1.5b now; Ollama prints live model progress below...\n'
        if dockerx exec "$OLLAMA_CONTAINER" ollama pull "$STARTER_MODEL"; then
          if dockerx exec "$OLLAMA_CONTAINER" ollama list 2>/dev/null | awk 'NR > 1 {print $1}' | grep -qx "$STARTER_MODEL"; then
            STARTER_MODEL_READY=1
          fi
        fi
      fi
    fi
    if [ "$STARTER_MODEL_READY" -eq 1 ]; then
      ok "Ollama is reachable and qwen2.5:1.5b is installed; no response-quality or speed claim is implied."
    elif [ "$OLLAMA_RUNTIME_READY" -eq 1 ]; then
      warn "Ollama is running, but the starter model pull did not complete. SMARAN.AI will show that model setup is required."
    else
      warn "The private Ollama runtime did not become ready. SMARAN.AI will continue without claiming a local model."
    fi
    ;;
esac

step 5 "Downloading latest SMARAN.AI" "Docker prints real layer-by-layer progress below; cached layers are reused."
dockerx pull "$IMAGE" || fail "Docker image download failed." "Check internet access, then run: docker pull $IMAGE"
ok "Latest image is available locally."

step 6 "Connecting verified host telemetry" "Extracting the bridge from this image, using an app-only Python environment, and waiting for fresh device metrics."
TELEMETRY_READY=0
TELEMETRY_MOUNTED=0
USER_PROFILE_DIR="${HOME:-}"
if [ -z "$USER_PROFILE_DIR" ]; then
  warn "No user home directory was reported; an app-specific host bridge directory cannot be created."
else
  if [ "$PLATFORM" = macos ]; then
    TELEMETRY_DIR="$USER_PROFILE_DIR/Library/Application Support/SMARAN.AI/telemetry"
  else
    STATE_ROOT="${XDG_STATE_HOME:-$USER_PROFILE_DIR/.local/state}"
    TELEMETRY_DIR="$STATE_ROOT/smaran-ai/telemetry"
  fi
  BRIDGE_SCRIPT="$TELEMETRY_DIR/host_telemetry_bridge.py"
  BRIDGE_TEMP="$TELEMETRY_DIR/host_telemetry_bridge.py.new.$$"
  HOST_STATS_FILE="$TELEMETRY_DIR/host_stats.json"
  BRIDGE_PID_FILE="$TELEMETRY_DIR/bridge.pid"
  BRIDGE_LOG="$TELEMETRY_DIR/bridge.log"
  BRIDGE_VENV="$TELEMETRY_DIR/python"
  VENV_PYTHON="$BRIDGE_VENV/bin/python"

  if mkdir -p "$TELEMETRY_DIR"; then
    chmod 700 "$TELEMETRY_DIR" 2>/dev/null || true
    if [ ! -f "$HOST_STATS_FILE" ]; then printf '{}\n' >"$HOST_STATS_FILE"; fi
    chmod 600 "$HOST_STATS_FILE" 2>/dev/null || true
    printf '           -> Private telemetry directory: %s\n' "$TELEMETRY_DIR"

    EXTRACT_CONTAINER=""
    BRIDGE_UPDATED=0
    printf '           -> Extracting the matching host bridge from the downloaded image...\n'
    EXTRACT_CONTAINER="$(dockerx create "$IMAGE" 2>/dev/null || true)"
    if [ -n "$EXTRACT_CONTAINER" ] && dockerx cp "$EXTRACT_CONTAINER:/opt/smaran/host_telemetry_bridge.py" "$BRIDGE_TEMP" >/dev/null 2>&1; then
      if mv "$BRIDGE_TEMP" "$BRIDGE_SCRIPT"; then
        BRIDGE_UPDATED=1
        chmod 600 "$BRIDGE_SCRIPT" 2>/dev/null || true
        ok "Host bridge extracted from the same image version."
      else
        warn "The extracted bridge could not be moved into the private application directory."
      fi
    else
      warn "The image bridge could not be extracted; a previously extracted bridge will be used only if it passes freshness checks."
    fi
    [ -z "$EXTRACT_CONTAINER" ] || dockerx rm -f "$EXTRACT_CONTAINER" >/dev/null 2>&1 || true
    rm -f "$BRIDGE_TEMP"

    OLD_BRIDGE_PID=""
    if [ -f "$BRIDGE_PID_FILE" ]; then OLD_BRIDGE_PID="$(sed -n '1p' "$BRIDGE_PID_FILE" 2>/dev/null || true)"; fi
    if owned_bridge_running && stats_fresh && [ "$BRIDGE_UPDATED" -ne 1 ]; then
      TELEMETRY_READY=1
      ok "Existing host bridge is healthy (PID $OLD_BRIDGE_PID)."
    elif owned_bridge_running; then
      if [ "$BRIDGE_UPDATED" -eq 1 ]; then
        printf '           -> Restarting verified bridge PID %s with the downloaded image version...\n' "$OLD_BRIDGE_PID"
      else
        warn "The previous SMARAN.AI bridge process is stale; restarting only PID $OLD_BRIDGE_PID."
      fi
      kill "$OLD_BRIDGE_PID" 2>/dev/null || true
      bridge_wait=0
      while kill -0 "$OLD_BRIDGE_PID" 2>/dev/null && [ "$bridge_wait" -lt 20 ]; do
        sleep 0.1
        bridge_wait=$((bridge_wait + 1))
      done
      if kill -0 "$OLD_BRIDGE_PID" 2>/dev/null; then
        warn "Bridge PID $OLD_BRIDGE_PID did not stop cleanly; forcing only this verified SMARAN.AI process to exit."
        kill -9 "$OLD_BRIDGE_PID" 2>/dev/null || true
      fi
    fi

    if [ "$TELEMETRY_READY" -ne 1 ] && [ -f "$BRIDGE_SCRIPT" ]; then
      HOST_PYTHON="$(find_python || true)"
      if [ -z "$HOST_PYTHON" ]; then
        warn "Python 3.9+ is absent. The installer will try the platform package manager and show all progress."
        if [ "$PLATFORM" = macos ] && have brew; then
          brew install python || warn "Homebrew could not install Python."
        elif [ "$PLATFORM" = linux ]; then
          if have apt-get; then
            rootx apt-get update && rootx apt-get install -y python3 python3-venv || warn "apt could not install Python and venv support."
          elif have dnf; then
            rootx dnf install -y python3 || warn "dnf could not install Python."
          elif have yum; then
            rootx yum install -y python3 || warn "yum could not install Python."
          elif have zypper; then
            rootx zypper --non-interactive install python3 python3-venv || warn "zypper could not install Python."
          elif have pacman; then
            rootx pacman -S --needed --noconfirm python || warn "pacman could not install Python."
          else
            warn "No supported Python package manager was detected."
          fi
        fi
        HOST_PYTHON="$(find_python || true)"
      fi

      if [ -n "$HOST_PYTHON" ]; then
        if [ ! -x "$VENV_PYTHON" ]; then
          printf '           -> Creating an app-only Python environment; system packages remain untouched...\n'
          if ! "$HOST_PYTHON" -m venv "$BRIDGE_VENV"; then
            if [ "$PLATFORM" = linux ] && have apt-get; then
              warn "Python venv support is missing; installing python3-venv and retrying once."
              rootx apt-get install -y python3-venv || true
              "$HOST_PYTHON" -m venv "$BRIDGE_VENV" || true
            fi
          fi
        fi
        if [ -x "$VENV_PYTHON" ]; then
          if ! "$VENV_PYTHON" -c 'import psutil' >/dev/null 2>&1; then
            printf '           -> Installing psutil into the app-only environment (binary package only)...\n'
            "$VENV_PYTHON" -m pip install --disable-pip-version-check --no-input --only-binary=:all: 'psutil>=5.9,<8' || true
          fi
          if "$VENV_PYTHON" -c 'import psutil' >/dev/null 2>&1; then
            printf '           -> Starting the host bridge in the background...\n'
            nohup "$VENV_PYTHON" -u "$BRIDGE_SCRIPT" --output "$HOST_STATS_FILE" >"$BRIDGE_LOG" 2>&1 </dev/null &
            BRIDGE_PID=$!
            printf '%s\n' "$BRIDGE_PID" >"$BRIDGE_PID_FILE"
            chmod 600 "$BRIDGE_PID_FILE" "$BRIDGE_LOG" 2>/dev/null || true
            bridge_attempt=1
            while [ "$bridge_attempt" -le 12 ]; do
              printf '\r           -> Verifying fresh host metrics... %s/12   ' "$bridge_attempt"
              sleep 1
              if stats_fresh; then TELEMETRY_READY=1; break; fi
              if ! kill -0 "$BRIDGE_PID" 2>/dev/null; then break; fi
              bridge_attempt=$((bridge_attempt + 1))
            done
            printf '\n'
            if [ "$TELEMETRY_READY" -eq 1 ]; then
              ok "Fresh host telemetry verified from PID $BRIDGE_PID."
            else
              kill "$BRIDGE_PID" 2>/dev/null || true
              warn "The bridge did not produce valid fresh metrics. Details: $BRIDGE_LOG"
            fi
          else
            warn "psutil could not be provisioned in the isolated environment."
          fi
        else
          warn "The isolated Python environment could not be created."
        fi
      else
        warn "Python 3.9+ remains unavailable, so the host bridge cannot run."
      fi
    fi
  else
    warn "The private telemetry directory could not be created."
  fi
fi
if [ "$TELEMETRY_READY" -ne 1 ]; then
  if [ -n "${HOST_STATS_FILE:-}" ] && [ -d "${TELEMETRY_DIR:-}" ]; then
    printf '{}\n' >"$HOST_STATS_FILE" 2>/dev/null || true
  fi
  warn "Host telemetry is unavailable. SMARAN.AI will use Docker container runtime metrics; no host values are guessed."
fi

step 7 "Repairing container and port mapping" "Old named container is preserved as a stopped backup; persistent data and downloaded models remain in named volumes."
existing="$(dockerx ps -aq --filter "name=^/${CONTAINER}$" 2>/dev/null || true)"
if [ -n "$existing" ]; then
  backup="${CONTAINER}-backup-$(date +%Y%m%d%H%M%S)"
  dockerx stop "$CONTAINER" >/dev/null 2>&1 || true
  dockerx rename "$CONTAINER" "$backup" || fail "Existing container could not be preserved." "Inspect it with: docker inspect $CONTAINER"
  warn "Existing container preserved as $backup."
fi
if port_busy; then fail "Port $PORT is occupied by another process." "Stop that process or rerun with: SMARAN_PORT=3004 sh install-smaran.sh"; fi
run_smaran_container() {
  host_stats_mode="$1"
  set -- -d --name "$CONTAINER" --restart unless-stopped -p "$PORT:3003" -v smaran_data:/app/data \
    -e "SMARAN_IMAGE=$IMAGE" -e "DATA_DIR=/app/data" -e "HF_HOME=/app/data/models" \
    -e "HUGGINGFACE_HUB_CACHE=/app/data/models/hub"
  if [ "$OLLAMA_RUNTIME_READY" -eq 1 ]; then
    set -- "$@" --network "$OLLAMA_NETWORK" -e "OLLAMA_URL=http://$OLLAMA_CONTAINER:11434" -e "INFERENCE_ENGINE=ollama"
  fi
  if [ "$STARTER_MODEL_READY" -eq 1 ]; then
    set -- "$@" -e "ACTIVE_MODEL=$STARTER_MODEL"
  fi
  if [ "$host_stats_mode" = mounted ]; then
    set -- "$@" --mount "type=bind,source=$HOST_STATS_FILE,target=/app/data/host_stats.json,readonly"
  fi
  dockerx run "$@" "$IMAGE"
}
RUN_OK=0
if [ "$TELEMETRY_READY" -eq 1 ]; then
  if run_smaran_container mounted >/dev/null; then
    RUN_OK=1
  else
    warn "Docker could not bind the verified host telemetry file. Retrying safely with container runtime telemetry."
    dockerx rm -f "$CONTAINER" >/dev/null 2>&1 || true
    TELEMETRY_READY=0
  fi
fi
if [ "$RUN_OK" -ne 1 ]; then
  run_smaran_container unmounted >/dev/null || fail "Container creation failed." "Run: docker logs $CONTAINER"
fi
published="$(dockerx port "$CONTAINER" 3003/tcp 2>/dev/null || true)"
printf '%s' "$published" | grep -q ":$PORT$" || fail "Docker did not publish port $PORT." "Run: docker inspect $CONTAINER"
ok "Verified Docker mapping: $published"

if [ "$TELEMETRY_READY" -eq 1 ]; then
  if dockerx exec "$CONTAINER" python -c "import json,time; p='/app/data/host_stats.json'; d=json.load(open(p)); raise SystemExit(0 if time.time()-float(d.get('timestamp',0)) < 8 else 1)" >/dev/null 2>&1; then
    TELEMETRY_MOUNTED=1
    ok "Read-only host_stats.json mount is visible inside SMARAN.AI."
  else
    TELEMETRY_READY=0
    warn "The host bridge is running, but the container cannot read its mount. The app will use container runtime telemetry."
  fi
fi

step 8 "Watching application startup" "Container state and recent logs remain visible while the health endpoint initializes."
URL="http://localhost:$PORT"
HEALTH="$URL/api/test/ping"
healthy=0
attempt=1
while [ "$attempt" -le 120 ]; do
  if have curl && curl -fsS --max-time 3 "$HEALTH" 2>/dev/null | grep -q '"status"[[:space:]]*:[[:space:]]*"ok"'; then healthy=1; break; fi
  if [ $((attempt % 5)) -eq 0 ]; then
    state="$(dockerx inspect --format '{{.State.Status}}' "$CONTAINER" 2>/dev/null || printf unknown)"
    lastlog="$(dockerx logs --tail 1 "$CONTAINER" 2>&1 | tail -n 1)"
    printf '           -> %ss | container=%s | %s\n' "$((attempt * 2))" "$state" "$lastlog"
  else
    printf '\r           -> Health check %s/120...   ' "$attempt"
  fi
  sleep 2
  attempt=$((attempt + 1))
done
printf '\n'
if [ "$healthy" -ne 1 ]; then
  printf '\n  ---------------- LAST CONTAINER LOGS ----------------\n'
  dockerx logs --tail 40 "$CONTAINER" 2>&1
  fail "SMARAN.AI did not pass its health check within 4 minutes." "Review the logs above, then run: docker restart $CONTAINER"
fi
ok "Health endpoint returned status=ok."

step 9 "Final verification" "Checking running state, local-model status, telemetry source, and browser URL before success is reported."
dockerx ps --filter "name=^/${CONTAINER}$" --format '           -> {{.Names}} | {{.Status}} | {{.Ports}}'
if [ "$TELEMETRY_MOUNTED" -eq 1 ]; then
  ok "Telemetry source: verified $PLATFORM host bridge (read-only mount)."
else
  warn "Telemetry source: Docker container runtime fallback."
fi
if [ "$STARTER_MODEL_READY" -eq 1 ]; then
  ok "Local AI source: private Ollama reachable; qwen2.5:1.5b installed (CPU starter)."
else
  warn "Local AI source: model setup required; no starter model is being claimed as ready."
fi
ok "SMARAN.AI is reachable at $URL"

step 10 "Opening SMARAN.AI" "The browser opens only after the server has passed its health check."
if [ "$PLATFORM" = macos ]; then open "$URL"
elif have xdg-open; then xdg-open "$URL" >/dev/null 2>&1 &
elif have gio; then gio open "$URL" >/dev/null 2>&1 &
else warn "No desktop browser opener was detected. Open $URL manually."; fi

printf '\n\033[1;32m  +--------------------------------------------------------------+\n'
printf '  |  READY: SMARAN.AI is running locally                         |\n'
printf '  |  URL: %-54s|\n' "$URL"
printf '  +--------------------------------------------------------------+\033[0m\n'
printf '  Stop later: docker stop %s\n  Start later: docker start %s\n' "$CONTAINER" "$CONTAINER"
