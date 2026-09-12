#!/usr/bin/env bash
#
# Build the Linux CLI binary (`smaran-linux-x86_64`) in WSL.
#
# There was no script for this. Previous ones were made by hand in
# ~/cli-linux-2035 and ~/cli-linux-2036 - the version code in the directory
# name being the only record of which release they belonged to - which is why
# the Linux CLI kept being the asset nobody rebuilt.
#
# Built in the WSL filesystem rather than under /mnt/c on purpose: PyInstaller
# writes thousands of small files, drvfs makes that crawl, and the executable
# bit does not survive there either.
#
#   wsl -d Ubuntu-24.04 -- bash /mnt/c/.../packaging/linux/build_cli_linux.sh
set -euo pipefail

REPO="/mnt/c/Users/shash/Desktop/SMARAN.AI"
VENV="/home/shash/smaran-build/venv"

VERSION="$(python3 - "$REPO" <<'PY'
import io, re, sys
raw = io.open(sys.argv[1] + "/cli/smaran_cli/__init__.py", encoding="utf-8").read()
print(re.search(r'__version__\s*=\s*"([0-9.]+)"', raw).group(1))
PY
)"
CODE="$(echo "$VERSION" | awk -F. '{printf "%d%02d%02d", $1, $2, $3}')"
OUT="/home/shash/cli-linux-$CODE"

echo "[cli] building SMARAN CLI $VERSION in $OUT"
rm -rf "$OUT"
mkdir -p "$OUT"

cd "$REPO/cli"
"$VENV/bin/python" -m PyInstaller --noconfirm --clean \
    --distpath "$OUT/dist" --workpath "$OUT/build" \
    smaran.spec

BIN="$OUT/dist/smaran"
test -x "$BIN" || { echo "[cli] no binary at $BIN" >&2; exit 1; }

echo "[cli] built $(stat -c%s "$BIN") bytes"
echo "[cli] --version says: $("$BIN" --version)"

# Copied out under the name the release and the website both expect.
cp "$BIN" "$REPO/build-linux/smaran-linux-x86_64"
echo "[cli] staged at build-linux/smaran-linux-x86_64"
