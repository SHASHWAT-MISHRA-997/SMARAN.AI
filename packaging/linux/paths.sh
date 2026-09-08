#!/usr/bin/env bash
# Shared output locations. Keep Linux audit builds separate from Windows dist/.
# Callers establish ROOT before sourcing this file.
BUILD_ROOT="$(realpath -m "${SMARAN_LINUX_BUILD_ROOT:-$ROOT}")"
case "$BUILD_ROOT" in
    "$ROOT"|"$ROOT"/*) ;;
    *) echo "Linux build output must remain inside the project: $BUILD_ROOT" >&2; exit 1 ;;
esac
export SMARAN_LINUX_BUILD_ROOT="$BUILD_ROOT"
FROZEN_DIR="$BUILD_ROOT/dist/SMARAN.AI"
PACKAGE_DIR="$BUILD_ROOT/dist/linux"
