#!/usr/bin/env bash
set -euo pipefail
tree="$(realpath "$1")"
target="$2"
test -f "$tree/DEBIAN/control"
test -f "$tree/opt/smaran-ai/SMARAN.AI"
find "$tree" -type d -exec chmod 755 {} +
# Retain helper executables (for example ffmpeg), while removing write
# permission for group/other. DrvFS may mark every payload file executable.
find "$tree" -type f -exec chmod a=rX,u+w {} +
chmod 644 "$tree/DEBIAN/control"
chmod 755 "$tree/usr/bin/smaran-ai" "$tree/opt/smaran-ai/SMARAN.AI"
dpkg-deb --build --root-owner-group "$tree" "$target"
