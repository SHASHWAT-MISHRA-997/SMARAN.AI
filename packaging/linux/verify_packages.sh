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
grep -oE 'assets/index-v[0-9.]+-[A-Za-z0-9_-]+\.js' /tmp/deblist.txt | head -2
