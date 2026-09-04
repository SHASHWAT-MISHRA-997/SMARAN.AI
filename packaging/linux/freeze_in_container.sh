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

# The Python version is named, not discovered.
#
# It was discovered - "take the newest" - and the newest in this image is
# /opt/python/cp315-cp315t: Python 3.15.0rc2, and the free-threaded build of
# it. A release candidate with a different ABI, which no dependency here has
# wheels for, so the install died on youtube-transcript-api and would have
# died on something else after that.
#
# 3.14 is what the Windows installer is built with. Two builds of the same
# release should not be running different interpreters, and the -t suffix is
# a different ABI rather than a newer version.
PY=/opt/python/cp314-cp314/bin/python
test -x "$PY" || {
    echo "[freeze] no Python 3.14 in this image. What it does have:" >&2
    ls -d /opt/python/cp3*-cp3* >&2
    exit 1
}
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
