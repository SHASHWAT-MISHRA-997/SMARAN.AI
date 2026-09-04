#!/usr/bin/env bash
#
# One file that runs on any Linux.
#
# A .deb only helps people on Debian and Ubuntu. A tar.gz built on Ubuntu 22.04
# refuses to start on anything older, with "version GLIBC_2.35 not found" -
# which names a library version and not the actual problem, and is where most
# people stop.
#
# An AppImage is the answer to both: a single file, made executable and run,
# with no package manager and no install step. It carries the application and
# its libraries; the only thing it needs from the host is a glibc at least as
# old as the one it was built against.
#
# WHICH GLIBC, AND WHY THAT ONE
#
# 2.28, because that is as far back as this app can go and not one version
# further. onnxruntime - which the dictation and the offline voice both need -
# publishes only manylinux_2_28 wheels. There is no build of it for anything
# older, so no amount of effort here reaches further back.
#
# 2.28 is Debian 10, Ubuntu 18.10, RHEL and Rocky and Alma 8, Fedora 29,
# openSUSE 15.1 - and everything released after any of those. That is every
# distribution still receiving updates and a good many that are not.
#
# So: build in a container that old, and the result runs everywhere newer.
# Building on the runner's own Ubuntu instead would silently raise the floor
# to whatever that runner happens to have.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

APP_ID="smaran-ai"
APP_NAME="SMARAN.AI"
VERSION="$(python3 -c "
import io, re
raw = io.open('backend/app/updates.py', encoding='utf-8').read()
print(re.search(r'\"SMARAN_APP_VERSION\",\s*\"([0-9.]+)\"', raw).group(1))
")"

test -x "dist/$APP_NAME/$APP_NAME" || {
    echo "[appimage] no frozen binary at dist/$APP_NAME/$APP_NAME" >&2
    exit 1
}

OUT="$ROOT/dist/linux"
mkdir -p "$OUT"
APPDIR="$ROOT/build/AppDir"
rm -rf "$APPDIR"
mkdir -p "$APPDIR/usr/lib/$APP_ID" "$APPDIR/usr/share/icons/hicolor/256x256/apps"

cp -a "dist/$APP_NAME/." "$APPDIR/usr/lib/$APP_ID/"
chmod 755 "$APPDIR/usr/lib/$APP_ID/$APP_NAME"

# AppRun is what actually starts when the file is run.
#
# It has to work from wherever the AppImage was mounted, which is not known
# until it runs - $APPDIR is set by the runtime and is the only reliable way
# to find our own files.
cat > "$APPDIR/AppRun" <<EOF
#!/bin/sh
HERE="\$(dirname "\$(readlink -f "\$0")")"
exec "\$HERE/usr/lib/$APP_ID/$APP_NAME" "\$@"
EOF
chmod 755 "$APPDIR/AppRun"

# The desktop entry has to sit at the top of the AppDir, and its Icon= has to
# match a file next to it by name, or appimagetool refuses to build.
cat > "$APPDIR/$APP_ID.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=$APP_NAME
Comment=A local-first AI assistant
Exec=AppRun
Icon=$APP_ID
Terminal=false
Categories=Development;
StartupWMClass=$APP_NAME
EOF

python3 - "$APPDIR/$APP_ID.png" <<'PY'
import sys
from PIL import Image

source = Image.open('website/assets/logo.png').convert('RGBA')
canvas = Image.new('RGBA', (256, 256), (0, 0, 0, 0))
scaled = source.copy()
scaled.thumbnail((256, 256), Image.LANCZOS)
canvas.paste(scaled, ((256 - scaled.width) // 2, (256 - scaled.height) // 2))
canvas.save(sys.argv[1])
PY
cp "$APPDIR/$APP_ID.png" "$APPDIR/usr/share/icons/hicolor/256x256/apps/$APP_ID.png"

# appimagetool is itself an AppImage, and mounting one needs FUSE, which a
# container does not have. --appimage-extract-and-run unpacks it to a
# temporary folder and runs it from there instead.
TOOL="$ROOT/build/appimagetool"
if [ ! -x "$TOOL" ]; then
    echo "[appimage] fetching appimagetool"
    curl -fsSL -o "$TOOL" \
        "https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage"
    chmod +x "$TOOL"
fi

TARGET="$OUT/${APP_NAME}-${VERSION}-x86_64.AppImage"
rm -f "$TARGET"
ARCH=x86_64 "$TOOL" --appimage-extract-and-run --no-appstream "$APPDIR" "$TARGET"
chmod +x "$TARGET"

echo "[appimage] built $(basename "$TARGET") ($(du -h "$TARGET" | cut -f1))"
rm -rf "$APPDIR"
