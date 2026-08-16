#!/bin/bash
set -euo pipefail

MODEL_ID=${ACTIVE_MODEL:-Qwen/Qwen3-4B-AWQ}
MAX_LEN=${MAX_MODEL_LEN:-2048}
GPU_UTIL=${VLLM_GPU_MEMORY_UTILIZATION:-0.75}

echo "========================================"
echo " SMARAN.AI Container Info"
echo "========================================"
echo " Image: ${HOSTNAME:-unknown}"
echo " Container ID: $(hostname)"
echo " Port: 3003"
echo " Model: $MODEL_ID"
echo " Max Context: $MAX_LEN"
echo "========================================"

cleanup() {
  if [[ -n ${VLLM_PID:-} ]]; then kill $VLLM_PID 2>/dev/null || true; fi
}
trap cleanup EXIT INT TERM

# ── Run hardware bootstrapper (writes hardware_config.json) ──────────────────
echo "[bootstrapper] Detecting host hardware..."
python3 -m bootstrapper || echo "[bootstrapper] Warning: hardware detection failed; will use runtime fallbacks."

if [[ -z ${VLLM_URL:-} ]]; then
  python3 -m vllm.entrypoints.openai.api_server \
    --model $MODEL_ID --port 8000 --host 127.0.0.1 \
    --max-model-len $MAX_LEN --gpu-memory-utilization $GPU_UTIL \
    --enforce-eager --dtype float16 --trust-remote-code &
  VLLM_PID=$!
  export VLLM_URL=http://127.0.0.1:8000/v1
fi

exec uvicorn app.main:app --host 0.0.0.0 --port 3003 --workers 1
