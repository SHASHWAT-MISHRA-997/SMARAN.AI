#!/usr/bin/env bash
#
# Freeze the application inside a container old enough to run anywhere.
#
# The one thing that decides whether a Linux binary is portable is the glibc it
# was linked against. Newer glibc can run older binaries; older glibc cannot run
# newer ones. So the build has to happen on the oldest system the app is meant
# to support, and everything newer then follows for free.
#
# manylinux_2_28 is that system: glibc 2.28, which is Debian 10, Ubuntu 18.10,
# RHEL and Rocky and Alma 8, Fedora 29, openSUSE 15.1, and every release after
# any of them. It is also the floor, not a choice - onnxruntime publishes no
# wheel for anything older, and the dictation and the offline voice both need
# it.
#
# The image is the one the Python packaging authority use to build the wheels
# on PyPI, which is the same problem this is: one binary, every distribution.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

IMAGE="quay.io/pypa/manylinux_2_28_x86_64:latest"
echo "[freeze] pulling $IMAGE"
docker pull -q "$IMAGE"

# The interface is already built, outside, where node is. Nothing in here
# needs it except as files to copy.
test -d backend/frontend_dist || {
    echo "[freeze] backend/frontend_dist is missing - build the interface first" >&2
    exit 1
}

docker run --rm \
    -v "$ROOT:/src" \
    -w /src \
    -e SMARAN_ANALYTICS_URL="${SMARAN_ANALYTICS_URL:-}" \
    -e SMARAN_ANALYTICS_KEY="${SMARAN_ANALYTICS_KEY:-}" \
    "$IMAGE" bash -c '
set -euo pipefail

# The image ships several CPythons under /opt/python. Take the newest rather
# than naming one: a hard-coded path breaks silently the day the image drops
# that version, and "python3 not found" is a clearer failure than a build that
# quietly used a different interpreter than intended.
PY=$(ls -d /opt/python/cp3*-cp3* 2>/dev/null | sort -V | tail -1)/bin/python
test -x "$PY" || { echo "[freeze] no CPython in the image" >&2; exit 1; }
echo "[freeze] using $("$PY" -V) at $PY"

"$PY" -m pip install --upgrade pip -q
"$PY" -m pip install -q -r requirements-build.txt

# The corpora the offline voice needs. Fetched here rather than left to the
# build script so that a network failure is its own visible error.
"$PY" -c "import nltk; [nltk.download(p, quiet=True) for p in (\"cmudict\",\"averaged_perceptron_tagger\",\"averaged_perceptron_tagger_eng\")]"

"$PY" build_exe.py

# Everything above ran as root inside the container, so the files it wrote are
# owned by root on the runner too - and the next step, which is not root,
# cannot touch them.
chown -R "$(stat -c %u /src):$(stat -c %g /src)" dist build backend/frontend_dist 2>/dev/null || true
'

test -x "dist/SMARAN.AI/SMARAN.AI" || {
    echo "[freeze] the container produced no binary" >&2
    exit 1
}
echo "[freeze] done -> dist/SMARAN.AI/SMARAN.AI"
