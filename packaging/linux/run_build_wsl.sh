#!/usr/bin/env bash
#
# Run the Linux package build from Windows, through WSL.
#
# Passing `export PATH=...:$PATH` on a `wsl.exe -- bash -c` command line does
# not survive: `$PATH` is expanded by the *Windows* shell first, and the
# Windows PATH is full of directories with spaces in them, so bash receives a
# dozen fragments and reports `not a valid identifier` for each one. Keeping
# the whole thing in a file means nothing is expanded before bash sees it.
#
#   wsl -d Ubuntu-24.04 -- bash /mnt/c/.../packaging/linux/run_build_wsl.sh
set -euo pipefail

REPO="/mnt/c/Users/shash/Desktop/SMARAN.AI"
VENV="/home/shash/smaran-build/venv"

# `build_linux.sh` shells out to plain `python3`, so the venv has to win on
# PATH rather than be named explicitly.
export PATH="$VENV/bin:$PATH"

# rpm was installed without root, into a prefix that only a login shell adds to
# PATH. This script is not a login shell, so `command -v rpmbuild` failed and
# build_linux.sh skipped the .rpm **silently** - it guards the whole rpm stage
# behind that check, so three packages appeared and nothing said the fourth was
# missing. Added explicitly so the set is always four.
RPM_PREFIX="/home/shash/rpmlocal/root/usr/bin"
RPM_LIBS="/home/shash/rpmlocal/root/usr/lib/x86_64-linux-gnu"
if [ -x "$RPM_PREFIX/rpmbuild" ]; then
    export PATH="$RPM_PREFIX:$PATH"
    # Same reason: installed under a prefix, so its own shared objects are not
    # where the loader looks. Without this `rpmbuild` is on PATH, passes the
    # `command -v` check, and then dies with "librpm.so.9: cannot open shared
    # object file" - which under `set -e` takes the AppImage stage down with
    # it, so the run ends with two packages instead of four.
    export LD_LIBRARY_PATH="$RPM_LIBS${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
    # And its macros and rpmrc, which it otherwise looks for at the absolute
    # /usr/lib/rpm regardless of where the binary lives: "Unable to open
    # /usr/lib/rpm/rpmrc for reading". Third prefix-related failure in a row,
    # each one only visible after fixing the previous.
    export RPM_CONFIGDIR="/home/shash/rpmlocal/root/usr/lib/rpm"
fi

# Must stay inside the repo: paths.sh rejects anything outside it, and the
# default root would put the frozen Linux app in dist/SMARAN.AI - the exact
# directory holding the Windows build.
export SMARAN_LINUX_BUILD_ROOT="$REPO/build-linux"

cd "$REPO"
echo "[wsl] python3 -> $(command -v python3)"
echo "[wsl] build root -> $SMARAN_LINUX_BUILD_ROOT"
exec packaging/linux/build_linux.sh
