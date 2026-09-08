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
# WHY NOT THE MANYLINUX IMAGE
#
# That was the obvious choice - it is what the Python packaging authority use
# to build the wheels on PyPI, which is the same problem this is. It does not
# work: manylinux builds its CPythons statically, and PyInstaller needs a
# shared libpython. The build gets all the way through collecting every
# dependency and then says
#
#     Python was built without a shared library, which is required by
#     PyInstaller
#
# Rocky 8 is the same glibc - 2.28, both being RHEL 8 underneath - and its
# python3.12 is a normal shared build. Same floor, and PyInstaller can use it.
#
# So Linux is built with 3.12 while Windows is built with 3.14. That is a real
# difference and worth stating: it is the price of reaching back to glibc 2.28
# at all. Every dependency here supports both, and the two youngest constraints
# in the tree - youtube-transcript-api at >=3.8,<3.15 and onnxruntime, which
# publishes cp312 manylinux_2_28 wheels - were checked on PyPI before choosing.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
source "$ROOT/packaging/linux/paths.sh"

IMAGE="rockylinux:8"
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
    -e SMARAN_BUILD_SUBDIR="${BUILD_ROOT#"$ROOT"}" \
    -e SMARAN_ANALYTICS_URL="${SMARAN_ANALYTICS_URL:-}" \
    -e SMARAN_ANALYTICS_KEY="${SMARAN_ANALYTICS_KEY:-}" \
    "$IMAGE" bash packaging/linux/container_build.sh

test -x "$FROZEN_DIR/SMARAN.AI" || {
    echo "[freeze] the container produced no binary" >&2
    exit 1
}
echo "[freeze] done -> $FROZEN_DIR/SMARAN.AI"
