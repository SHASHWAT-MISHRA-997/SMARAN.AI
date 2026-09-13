#!/usr/bin/env bash
#
# Check the built Linux packages by content, not by filename.
#
# Two things this exists to catch:
#   * a package whose name says 2.10.38 while its payload is an older build;
#   * the world-writable payload. /mnt/c is mounted 9p/drvfs without
#     `metadata`, so chmod does not persist and everything reads back 0777.
#     build_deb.sh and build_rpm.sh both work inside one fakeroot session for
#     that reason; run outside it, rpmbuild reads the real filesystem and ships
#     an rpm where even /opt/smaran-ai/SMARAN.AI is writable by anyone.
set -uo pipefail

PREFIX="/home/shash/rpmlocal/root"
export LD_LIBRARY_PATH="$PREFIX/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export RPM_CONFIGDIR="$PREFIX/usr/lib/rpm"
RPM="$PREFIX/usr/bin/rpm"

cd "$(dirname "$0")/../../build-linux/dist/linux" || exit 1

RPM_FILE="$(ls -1 *.rpm 2>/dev/null | head -1)"
DEB_FILE="$(ls -1 *.deb 2>/dev/null | head -1)"

echo "=== rpm identity ==="
"$RPM" -qp --qf '%{NAME} %{VERSION}-%{RELEASE} %{ARCH}\n' "$RPM_FILE" 2>/dev/null

echo "=== rpm permissions ==="
"$RPM" -qlvp "$RPM_FILE" 2>/dev/null > /tmp/rpmlist.txt
total=$(wc -l < /tmp/rpmlist.txt)
ww=$(awk '{ if (substr($1,9,1) == "w") c++ } END { print c+0 }' /tmp/rpmlist.txt)
echo "entries: $total, world-writable: $ww"
echo "app binary:"
grep -E '/opt/smaran-ai/SMARAN\.AI$' /tmp/rpmlist.txt | head -1

echo "=== deb identity ==="
dpkg-deb -f "$DEB_FILE" Package Version Architecture 2>/dev/null

echo "=== deb permissions (world-writable count) ==="
dpkg-deb -c "$DEB_FILE" 2>/dev/null > /tmp/deblist.txt
dtotal=$(wc -l < /tmp/deblist.txt)
dww=$(awk '{ if (substr($1,9,1) == "w") c++ } END { print c+0 }' /tmp/deblist.txt)
echo "entries: $dtotal, world-writable: $dww"

echo "=== frontend bundle shipped inside the deb ==="
BUNDLE="$(grep -oE 'assets/index-v[0-9.]+-[A-Za-z0-9_-]+\.js' /tmp/deblist.txt | head -1)"
echo "${BUNDLE:-(none found)}"

# This printed the bundle name and stopped, leaving a person to notice that it
# disagreed with the package version. Nobody reliably does: 2.10.39's deb went
# out declaring 2.10.39 around a 2.10.38 payload and the mismatch was two lines
# apart in this very output. The check the header promises is now made here.
failures=0
note_failure() { echo "FAIL: $*"; failures=$((failures + 1)); }

DEB_VERSION="$(dpkg-deb -f "$DEB_FILE" Version 2>/dev/null)"
if [ -z "$BUNDLE" ]; then
    note_failure "no frontend bundle found inside $DEB_FILE"
elif ! printf '%s' "$BUNDLE" | grep -q -- "-v$DEB_VERSION-"; then
    note_failure "$DEB_FILE declares $DEB_VERSION but ships $BUNDLE"
fi

# The permission counts were printed for a human too, and zero is the only
# acceptable answer for either.
[ "$ww" -eq 0 ]  || note_failure "$RPM_FILE has $ww world-writable entries"
[ "$dww" -eq 0 ] || note_failure "$DEB_FILE has $dww world-writable entries"

echo "=== result ==="
if [ "$failures" -eq 0 ]; then
    echo "OK: payload matches $DEB_VERSION, no world-writable entries"
else
    echo "$failures check(s) failed"
fi
exit "$failures"
