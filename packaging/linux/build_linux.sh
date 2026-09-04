#!/usr/bin/env bash
#
# Package SMARAN.AI for Linux, for any distribution:
#
#   .AppImage   one file, made executable and run. No package manager, no
#               install, no distribution of its own. This is the one that
#               works everywhere and the one the website leads with.
#   .deb        Debian, Ubuntu, Mint, Pop!_OS - for people who would rather
#               it appeared in their package list.
#   .rpm        Fedora, RHEL, Rocky, Alma, openSUSE, for the same reason.
#   .tar.gz     unpack anywhere and run ./run.sh.
#
# All four hold the same frozen application, built once.
#
# WHY THERE IS NO NATIVE WINDOW HERE
#
# On Windows the app opens in a real window through WebView2, which ships with
# the operating system. The Linux equivalent is WebKit2GTK, reached through
# PyGObject - and that stack cannot be frozen the way the rest of this can.
# PyInstaller freezes Python modules; the GObject introspection stack is
# typelibs, libgirepository and pixbuf loaders living outside the Python
# environment. Worse, WebKit2GTK split its ABI at 4.0 and 4.1 (libsoup2 versus
# libsoup3), so a bundle built against one is not found on a distribution
# carrying the other. One package cannot cover both.
#
# So on Linux the app opens a browser window with no address bar and no tabs -
# the `--app=` window Chrome, Chromium, Brave, Edge and Vivaldi all support.
# The same page, the same backend, drawn by a browser that is already on the
# machine and already up to date. What is lost is that the window belongs to
# the browser process rather than to us.
#
# That is a real difference from the Windows build, and it is written on the
# download page rather than discovered after installing.
#
# Run from the repository root:  packaging/linux/build_linux.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

APP_ID="smaran-ai"
APP_NAME="SMARAN.AI"
VERSION="$(python3 - <<'PY'
import io, re
raw = io.open('backend/app/updates.py', encoding='utf-8').read()
print(re.search(r'"SMARAN_APP_VERSION",\s*"([0-9.]+)"', raw).group(1))
PY
)"
echo "[linux] packaging $APP_NAME $VERSION"

# ── the frozen application ────────────────────────────────────────────────
if [ ! -x "dist/$APP_NAME/$APP_NAME" ]; then
    echo "[linux] building the application first"
    python3 build_exe.py
fi
test -x "dist/$APP_NAME/$APP_NAME" || {
    echo "[linux] no frozen binary at dist/$APP_NAME/$APP_NAME" >&2
    exit 1
}

OUT="$ROOT/dist/linux"
rm -rf "$OUT"
mkdir -p "$OUT"

# ── the file tree, laid out the way a Debian package expects ──────────────
TREE="$OUT/tree"
mkdir -p "$TREE/opt/$APP_ID" \
         "$TREE/usr/bin" \
         "$TREE/usr/share/applications" \
         "$TREE/usr/share/icons/hicolor/256x256/apps" \
         "$TREE/DEBIAN"

cp -a "dist/$APP_NAME/." "$TREE/opt/$APP_ID/"
chmod 755 "$TREE/opt/$APP_ID/$APP_NAME"

# The launcher. Named in lower case with a dash because that is what a person
# types, and because a command with a dot and capitals in it is a small daily
# annoyance for no reason.
cat > "$TREE/usr/bin/$APP_ID" <<EOF
#!/bin/sh
exec "/opt/$APP_ID/$APP_NAME" "\$@"
EOF
chmod 755 "$TREE/usr/bin/$APP_ID"

cat > "$TREE/usr/share/applications/$APP_ID.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=$APP_NAME
Comment=A local-first AI assistant
Exec=/usr/bin/$APP_ID
Icon=$APP_ID
Terminal=false
Categories=Development;
StartupWMClass=$APP_NAME
EOF

python3 - "$TREE/usr/share/icons/hicolor/256x256/apps/$APP_ID.png" <<'PY'
import sys
from PIL import Image

# The icon is small and square-ish; a menu entry wants 256x256 exactly, and a
# stretched logo in an application menu looks like a broken package.
source = Image.open('website/assets/logo.png').convert('RGBA')
canvas = Image.new('RGBA', (256, 256), (0, 0, 0, 0))
scaled = source.copy()
scaled.thumbnail((256, 256), Image.LANCZOS)
canvas.paste(scaled, ((256 - scaled.width) // 2, (256 - scaled.height) // 2))
canvas.save(sys.argv[1])
PY

INSTALLED_KB="$(du -sk "$TREE/opt" | cut -f1)"

cat > "$TREE/DEBIAN/control" <<EOF
Package: $APP_ID
Version: $VERSION
Section: utils
Priority: optional
Architecture: amd64
Maintainer: Shashwat Mishra <shashwatmba209@gmail.com>
Installed-Size: $INSTALLED_KB
Depends: libc6 (>= 2.28)
Recommends: chromium | chromium-browser | google-chrome-stable | brave-browser
Description: SMARAN.AI - a local-first AI assistant
 Runs on your own machine. Bring an API key or a model in Ollama; nothing
 else has to be installed and nothing is sent anywhere you did not choose.
 .
 On Linux the interface opens in a browser window with no address bar and no
 tabs, rather than in a native window. The Windows build uses the webview
 that ships with the system; the Linux equivalent, WebKit2GTK, cannot be
 bundled portably because its 4.0 and 4.1 builds are not interchangeable.
 Any of Chromium, Chrome, Brave, Edge or Vivaldi will do; if none is present
 it falls back to the default browser.
EOF

dpkg-deb --build --root-owner-group "$TREE" "$OUT/${APP_ID}_${VERSION}_amd64.deb" >/dev/null
echo "[linux] built $(basename "$OUT/${APP_ID}_${VERSION}_amd64.deb")"

# ── the portable archive, for everything that is not Debian ───────────────
PORTABLE="$OUT/portable/$APP_ID-$VERSION"
mkdir -p "$PORTABLE"
cp -a "dist/$APP_NAME/." "$PORTABLE/"
cat > "$PORTABLE/run.sh" <<EOF
#!/bin/sh
# Start SMARAN.AI from wherever this folder happens to be.
cd "\$(dirname "\$0")"
exec "./$APP_NAME" "\$@"
EOF
chmod 755 "$PORTABLE/run.sh" "$PORTABLE/$APP_NAME"
tar -C "$OUT/portable" -czf "$OUT/${APP_ID}-${VERSION}-linux-x86_64.tar.gz" "$APP_ID-$VERSION"
rm -rf "$OUT/portable"
echo "[linux] built $(basename "$OUT/${APP_ID}-${VERSION}-linux-x86_64.tar.gz")"

# ── an rpm, for Fedora, RHEL and openSUSE ─────────────────────────────────
# Built from the same tree the .deb was built from, so the two packages can
# never drift apart in what they contain or where they put it.
if command -v rpmbuild >/dev/null 2>&1; then
    # The Debian metadata has to go before rpmbuild sees this tree. rpmbuild
    # treats anything in the buildroot that is not listed in %files as an
    # error - "Installed (but unpackaged) file(s) found: /DEBIAN/control" -
    # rather than ignoring it, which is the safer behaviour and not what I
    # assumed when the two packages were made to share one tree.
    rm -rf "$TREE/DEBIAN"

    RPMROOT="$OUT/rpmbuild"
    mkdir -p "$RPMROOT/BUILD" "$RPMROOT/RPMS" "$RPMROOT/SPECS"
    cat > "$RPMROOT/SPECS/$APP_ID.spec" <<EOF
Name:           $APP_ID
Version:        $VERSION
Release:        1
Summary:        SMARAN.AI - a local-first AI assistant
License:        MIT
BuildArch:      x86_64
AutoReqProv:    no
Recommends:     (chromium or chromium-browser or google-chrome-stable)

%description
Runs on your own machine. Bring an API key or a model in Ollama; nothing else
has to be installed and nothing is sent anywhere you did not choose.

On Linux the interface opens in a browser window with no address bar and no
tabs rather than in a native window, because the Linux equivalent of the
webview Windows ships with cannot be bundled to work across distributions.

%files
/opt/$APP_ID
/usr/bin/$APP_ID
/usr/share/applications/$APP_ID.desktop
/usr/share/icons/hicolor/256x256/apps/$APP_ID.png

%post
/usr/bin/update-desktop-database >/dev/null 2>&1 || :
EOF
    # AutoReqProv is off deliberately. Left on, rpmbuild scans every bundled
    # shared object and writes a Requires for each one - including the private
    # copies this bundle carries - and the package then refuses to install on
    # the machine it was built for.
    rpmbuild --quiet         --define "_topdir $RPMROOT"         --define "_rpmdir $OUT"         --define "_build_id_links none"         --buildroot "$TREE"         -bb "$RPMROOT/SPECS/$APP_ID.spec"
    find "$OUT" -name '*.rpm' -exec mv -f {} "$OUT/" ';' 2>/dev/null || true
    rm -rf "$RPMROOT" "$OUT/x86_64"
    echo "[linux] built $(cd "$OUT" && ls *.rpm)"
else
    echo "[linux] rpmbuild is not here, so no .rpm was built"
fi

rm -rf "$TREE"

# ── the AppImage, which is the one that runs anywhere ─────────────────────
"$ROOT/packaging/linux/make_appimage.sh"

ls -la "$OUT"
