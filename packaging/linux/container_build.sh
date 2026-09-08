#!/usr/bin/env bash
set -euo pipefail

dnf update -y -q expat >/dev/null
dnf install -y -q python3.12 python3.12-pip python3.12-devel gcc make >/dev/null

PY=/usr/bin/python3.12
test -x "$PY" || { echo "[freeze] python3.12 did not install" >&2; exit 1; }
"$PY" -m pip --version >/dev/null 2>&1 || "$PY" -m ensurepip --upgrade
echo "[freeze] Python executable: $PY"

"$PY" -m pip install --upgrade pip -q
"$PY" -m pip install -q -r requirements-build.txt
"$PY" -m pip install -q pysqlite3-binary
"$PY" -c 'import nltk; [nltk.download(p, quiet=True) for p in ("cmudict", "averaged_perceptron_tagger", "averaged_perceptron_tagger_eng")]'

OUTPUT_ROOT="/src${SMARAN_BUILD_SUBDIR:-}"
export PYTHONPATH="/src/packaging/linux/build-support${PYTHONPATH:+:$PYTHONPATH}"
"$PY" build_exe.py --output-root "$OUTPUT_ROOT"
