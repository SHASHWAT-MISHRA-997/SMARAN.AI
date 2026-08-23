#!/bin/bash
set -euo pipefail

MODEL_ID=${VLLM_MODEL:-${ACTIVE_MODEL:-}}
MAX_LEN=${MAX_MODEL_LEN:-2048}
GPU_UTIL=${VLLM_GPU_MEMORY_UTILIZATION:-0.75}
export DATA_DIR=${DATA_DIR:-/app/data}
export HF_HOME=${HF_HOME:-$DATA_DIR/models}
export HUGGINGFACE_HUB_CACHE=${HUGGINGFACE_HUB_CACHE:-$HF_HOME/hub}
mkdir -p "$DATA_DIR" "$HF_HOME" "$HUGGINGFACE_HUB_CACHE"

echo "========================================"
echo " SMARAN.AI Container Info"
echo "========================================"
echo " Image: ${HOSTNAME:-unknown}"
echo " Container ID: $(hostname)"
echo " Port: 3003"
echo " vLLM Model: ${MODEL_ID:-not configured}"
echo " Max Context: $MAX_LEN"
echo "========================================"

cleanup() {
  if [[ -n ${VLLM_PID:-} ]]; then kill $VLLM_PID 2>/dev/null || true; fi
}
trap cleanup EXIT INT TERM

# ── Run hardware bootstrapper (writes hardware_config.json) ──────────────────
echo "[bootstrapper] Detecting host hardware..."
python3 -m bootstrapper || echo "[bootstrapper] Warning: hardware detection failed; will use runtime fallbacks."

if [[ -n "$MODEL_ID" ]] && [[ -z ${VLLM_URL:-} ]] && python3 -c 'import vllm' >/dev/null 2>&1; then
  python3 -m vllm.entrypoints.openai.api_server \
    --model "$MODEL_ID" --port 8000 --host 127.0.0.1 \
    --max-model-len "$MAX_LEN" --gpu-memory-utilization "$GPU_UTIL" \
    --enforce-eager --dtype float16 --trust-remote-code &
  VLLM_PID=$!
  export VLLM_URL=http://127.0.0.1:8000/v1
elif [[ -n "$MODEL_ID" ]] && [[ -z ${VLLM_URL:-} ]]; then
  echo "[inference] No bundled vLLM runtime detected. Waiting for an installed Ollama model or configured external/cloud provider."
elif [[ -z ${VLLM_URL:-} ]]; then
  echo "[inference] No local vLLM model configured. Runtime readiness will be detected from Ollama, an external vLLM URL, or cloud credentials."
fi

exec uvicorn app.main:app --host 0.0.0.0 --port 3003 --workers 1
