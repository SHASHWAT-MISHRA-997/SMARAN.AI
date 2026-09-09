#!/usr/bin/env bash
#
# Build the .rpm from the same tree the .deb was built from.
#
# This exists for the same reason build_deb.sh does: the permissions have to be
# set and the package written inside one fakeroot session.
#
# The tree usually lives under /mnt/c, which WSL mounts 9p/drvfs without the
# `metadata` option. There, chmod does not persist and every file reads back as
# 0777. build_deb.sh works because fakeroot remembers the modes it was asked
# for and dpkg-deb, running in the same session, sees them. rpmbuild was
# previously run outside any such session, read the real filesystem, and
# produced an rpm in which every file and directory was world-writable -
# including the application binary in /opt - while the .deb from the identical
# tree was correct.
#
# Called as: build_rpm.sh <tree> <rpmroot> <outdir> <app-id> <spec>
set -euo pipefail

tree="$(realpath "$1")"
rpmroot="$2"
outdir="$3"
app_id="$4"
spec="$5"

test -f "$spec"
test -f "$tree/opt/$app_id/SMARAN.AI"

# The same pass build_deb.sh applies. Capital X keeps the execute bit on
# directories and on files that already had one, so bundled helpers such as
# ffmpeg stay runnable while group and other lose write.
find "$tree" -type d -exec chmod 755 {} +
find "$tree" -type f -exec chmod a=rX,u+w {} +
chmod 755 "$tree/usr/bin/$app_id" "$tree/opt/$app_id/SMARAN.AI"

# AutoReqProv is off in the spec deliberately; see build_linux.sh.
rpmbuild --quiet \
    --define "_topdir $rpmroot" \
    --define "_rpmdir $outdir" \
    --define "_build_id_links none" \
    --buildroot "$tree" \
    -bb "$spec"
