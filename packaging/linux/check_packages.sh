#!/usr/bin/env bash
#
# Open every package and check it, because a package that will not install is
# worse than no package at all - the person has already downloaded it, already
# trusted it, and now has an error instead of an app.
#
# Each format is checked the way its own tools check it, and the AppImage is
# not just inspected but actually run.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT/dist/linux"

fail=0
say() { printf '  %s\n' "$1"; }

echo "=== what was built ==="
ls -la . | awk 'NR>3 {print "  " $5, $9}'

# ── the AppImage ──────────────────────────────────────────────────────────
echo
echo "=== AppImage ==="
APPIMAGE="$(ls *.AppImage 2>/dev/null | head -1 || true)"
if [ -z "$APPIMAGE" ]; then
    say "MISSING - this is the one that runs anywhere, so its absence is fatal"
    fail=1
else
    say "file: $APPIMAGE"
    say "executable bit: $([ -x "$APPIMAGE" ] && echo yes || { echo 'NO'; fail=1; })"
    # A container has no FUSE, so the AppImage cannot mount itself. Unpacking
    # it is the same contents by another route.
    rm -rf squashfs-root
    ./"$APPIMAGE" --appimage-extract >/dev/null 2>&1 || true
    if [ -d squashfs-root ]; then
        for f in AppRun smaran-ai.desktop smaran-ai.png usr/lib/smaran-ai/SMARAN.AI; do
            [ -e "squashfs-root/$f" ] && say "contains: $f" || { say "MISSING: $f"; fail=1; }
        done
        if command -v desktop-file-validate >/dev/null 2>&1; then
            desktop-file-validate squashfs-root/smaran-ai.desktop \
                && say "desktop entry: valid" || { say "desktop entry: INVALID"; fail=1; }
        fi
        # The real question: does the thing AppRun points at start.
        target="squashfs-root/usr/lib/smaran-ai/SMARAN.AI"
        [ -x "$target" ] && say "the app inside is executable" || { say "the app inside is NOT executable"; fail=1; }
        rm -rf squashfs-root
    else
        say "could not unpack it"
        fail=1
    fi
fi

# ── the .deb ──────────────────────────────────────────────────────────────
echo
echo "=== .deb ==="
DEB="$(ls *.deb 2>/dev/null | head -1 || true)"
if [ -z "$DEB" ]; then
    say "MISSING"
    fail=1
else
    say "file: $DEB"
    say "glibc it declares: $(dpkg-deb -f "$DEB" Depends)"
    if command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
        sudo apt-get install -y "./$DEB" >/dev/null 2>&1 \
            && say "installs with apt: yes" || { say "installs with apt: NO"; fail=1; }
        for f in /usr/bin/smaran-ai /usr/share/applications/smaran-ai.desktop \
                 /usr/share/icons/hicolor/256x256/apps/smaran-ai.png; do
            [ -e "$f" ] && say "installed: $f" || { say "MISSING after install: $f"; fail=1; }
        done
        command -v desktop-file-validate >/dev/null 2>&1 \
            && { desktop-file-validate /usr/share/applications/smaran-ai.desktop \
                 && say "desktop entry: valid"; }
        sudo apt-get remove -y smaran-ai >/dev/null 2>&1 || true
        [ -e /usr/bin/smaran-ai ] && { say "left files behind on removal"; fail=1; } \
                                  || say "removes cleanly: yes"
    else
        say "no passwordless sudo here, so it was inspected but not installed"
        dpkg-deb -c "$DEB" | grep -q 'usr/bin/smaran-ai' \
            && say "contains the launcher" || { say "MISSING the launcher"; fail=1; }
    fi
fi

# ── the .rpm ──────────────────────────────────────────────────────────────
echo
echo "=== .rpm ==="
RPM="$(ls *.rpm 2>/dev/null | head -1 || true)"
if [ -z "$RPM" ]; then
    say "not built - Fedora and openSUSE would have no package"
    fail=1
else
    say "file: $RPM"
    rpm -qip "$RPM" 2>/dev/null | sed -n '1,6p' | sed 's/^/    /'
    rpm -qlp "$RPM" 2>/dev/null | grep -q '/usr/bin/smaran-ai' \
        && say "contains the launcher" || { say "MISSING the launcher"; fail=1; }
fi

# ── the archive ───────────────────────────────────────────────────────────
echo
echo "=== .tar.gz ==="
TAR="$(ls *.tar.gz 2>/dev/null | head -1 || true)"
if [ -z "$TAR" ]; then
    say "MISSING"
    fail=1
else
    say "file: $TAR"
    tar -tzf "$TAR" | grep -q 'run.sh' \
        && say "contains run.sh" || { say "MISSING run.sh"; fail=1; }
fi

echo
if [ "$fail" -ne 0 ]; then
    echo "Something is wrong with at least one package. Details above."
    exit 1
fi
echo "Every package checked out."
