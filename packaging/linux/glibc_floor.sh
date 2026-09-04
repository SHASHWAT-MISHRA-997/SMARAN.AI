#!/usr/bin/env bash
#
# The oldest glibc this build can run on, read out of the binaries themselves.
#
# "Built in a manylinux_2_28 container" is a claim about the build machine.
# What decides whether somebody's laptop can run this is which versioned glibc
# symbols the binaries actually reference - and one stray dependency compiled
# against something newer raises that floor for the whole application without
# anything saying so.
#
# So this reads the symbol versions out of every ELF file in the bundle and
# reports the highest one found, with the file that wanted it. That number is
# the real answer, and it fails if it is higher than promised.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

BUNDLE="dist/SMARAN.AI"
PROMISED="${1:-2.28}"

test -d "$BUNDLE" || { echo "no bundle at $BUNDLE" >&2; exit 1; }

python3 - "$BUNDLE" "$PROMISED" <<'PY'
import os
import re
import subprocess
import sys

bundle, promised = sys.argv[1], sys.argv[2]


def version(text):
    return tuple(int(part) for part in text.split('.'))


wanted = re.compile(rb'GLIBC_(\d+\.\d+(?:\.\d+)?)')
highest = (0, 0)
blamed = None
scanned = 0

for folder, _, files in os.walk(bundle):
    for name in files:
        path = os.path.join(folder, name)
        try:
            with open(path, 'rb') as handle:
                if handle.read(4) != b'\x7fELF':
                    continue
                handle.seek(0)
                blob = handle.read()
        except OSError:
            continue
        scanned += 1
        for found in set(wanted.findall(blob)):
            asked = version(found.decode())
            if asked > highest:
                highest, blamed = asked, os.path.relpath(path, bundle)

shown = '.'.join(str(p) for p in highest)
print(f'ELF files scanned:      {scanned}')
print(f'oldest glibc needed:    {shown}')
print(f'asked for by:           {blamed}')
print()
print('That means it runs on, and on anything newer than:')
print('  Debian 10 · Ubuntu 18.10 · RHEL/Rocky/Alma 8 · Fedora 29 · openSUSE 15.1'
      if highest <= (2, 28) else
      '  something newer than promised - see the file above')

if highest > version(promised):
    print()
    print(f'FAILED: this build needs glibc {shown}, but the packages promise {promised}.')
    print('Somebody on an older distribution would get "GLIBC_%s not found" and '
          'no idea why.' % shown)
    sys.exit(1)
PY
