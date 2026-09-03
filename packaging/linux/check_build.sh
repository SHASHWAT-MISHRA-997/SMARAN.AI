#!/usr/bin/env bash
#
# Two questions a green build has answered wrongly before: does it contain the
# things the voice needs, and does it actually start.
#
# The Windows job checks the first. It has caught a build whose voice was
# missing and whose build log said nothing at all, which is the entire reason
# that check exists. This is the same check with the extension Linux uses, plus
# the second question, which nothing has ever asked: a binary that exists and a
# binary that runs are different claims.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

INTERNAL="dist/SMARAN.AI/_internal"
missing=0

report() {
    echo "  missing: $1"
    missing=1
}

ls "$INTERNAL"/onnxruntime/capi/onnxruntime_pybind11_state*.so >/dev/null 2>&1 \
    || report "onnxruntime_pybind11_state.so - dictation and the offline voice both need it"
[ -d "$INTERNAL/nltk_data/corpora/cmudict" ] \
    || report "nltk cmudict - the offline voice cannot start without it"
[ -d "$INTERNAL/faster_whisper/assets" ] \
    || report "faster-whisper assets - the voice-activity model"

if [ "$missing" -ne 0 ]; then
    echo "This build would ship with a broken voice."
    exit 1
fi
echo "Voice components are present."

# ── does it start ─────────────────────────────────────────────────────────
# No display is attached here, so the window cannot open and is not expected
# to. What is being asked is narrower and still worth asking: does the backend
# inside this binary come up and answer.
WORK="$(mktemp -d)"
export DATA_DIR="$WORK"
echo "Starting it with DATA_DIR=$WORK"

./dist/SMARAN.AI/SMARAN.AI > "$WORK/out.log" 2>&1 &
app=$!

answered=0
for _ in $(seq 1 90); do
    if ! kill -0 "$app" 2>/dev/null; then
        break
    fi
    # The app writes runtime.json beside its data with the port it actually
    # bound to - it does not always get the one it asked for.
    if [ -f "$WORK/runtime.json" ]; then
        port="$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['port'])" "$WORK/runtime.json" 2>/dev/null || true)"
        if [ -n "$port" ] && curl -fsS "http://127.0.0.1:$port/api/test/ping" >/dev/null 2>&1; then
            echo "The backend answered on port $port."
            answered=1
            break
        fi
    fi
    sleep 1
done

kill "$app" 2>/dev/null || true
wait "$app" 2>/dev/null || true

if [ "$answered" -ne 1 ]; then
    echo "It never answered. The last of what it printed:"
    tail -40 "$WORK/out.log" || true
    exit 1
fi
echo "It starts and serves."
