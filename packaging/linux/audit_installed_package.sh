#!/usr/bin/env bash
# Install the published Linux package on a real Linux system and prove it runs.
#
# The .deb had been built and never installed. Building a package and
# installing one are different claims: the second is the one a user makes.
#
# Run inside WSL Ubuntu:
#   bash /mnt/c/Users/shash/Desktop/SMARAN.AI/.cache/audit/linux_package_audit.sh
set -u

WORK=/var/tmp/smaran-linux-audit
URL=https://github.com/SHASHWAT-MISHRA-997/SMARAN.AI-downloads/releases/latest/download/smaran-ai_amd64.deb
# The app serves on 3003 and opens a browser at it. --port was ignored,
# so the first run of this script pinged a port nothing was listening on
# and called a working install a failure.
PORT=3003

say() { printf '%-4s %s\n' "$1" "$2"; }

rm -rf "$WORK"
mkdir -p "$WORK"
cd "$WORK" || exit 1

echo "=== download ==="
curl -sL -o smaran.deb "$URL" || { say FAIL "download"; exit 1; }
SIZE=$(stat -c%s smaran.deb)
say PASS "downloaded $SIZE bytes"
sha256sum smaran.deb

echo
echo "=== package metadata ==="
dpkg-deb --field smaran.deb Package Version Architecture Depends
VERSION=$(dpkg-deb --field smaran.deb Version)

echo
echo "=== the frontend inside the package ==="
mkdir -p x
dpkg-deb --fsys-tarfile smaran.deb | tar -xf - -C x
DIST="$WORK/x/opt/smaran-ai/_internal/frontend_dist"
ON_DISK=$(ls "$DIST/assets" | grep -oE 'v2\.10\.[0-9]+' | sort -u | tr '\n' ' ')
REFERENCED=$(grep -oE 'v2\.10\.[0-9]+' "$DIST/index.html" | sort -u | tr '\n' ' ')
say INFO "assets on disk : $ON_DISK"
say INFO "referenced     : $REFERENCED"
if grep -ql "X-Companion-Token" "$DIST"/assets/index-*.js; then
  say PASS "this release's frontend change is inside the package"
else
  say FAIL "the packaged bundle does not contain this release's change"
fi

echo
echo "=== install ==="
dpkg -i smaran.deb >/dev/null 2>&1 || apt-get -y -f install >/dev/null 2>&1
if dpkg -s smaran-ai >/dev/null 2>&1; then
  INSTALLED=$(dpkg -s smaran-ai | awk '/^Version:/{print $2}')
  say PASS "installed, dpkg reports version $INSTALLED"
else
  say FAIL "package did not install"
  exit 1
fi

for p in /usr/bin/smaran-ai /usr/share/applications/smaran-ai.desktop; do
  [ -e "$p" ] && say PASS "present: $p" || say FAIL "missing: $p"
done

echo
echo "=== does it actually run ==="
# BROWSER=true stops xdg-open hunting for a browser that a headless box
# does not have; it does not change what the server does.
BROWSER=true SMARAN_APP_VERSION="$VERSION" nohup /usr/bin/smaran-ai >"$WORK/run.log" 2>&1 &
APP_PID=$!
# First launch warms a speech model from a cold cache, which took about 90
# seconds here. Two minutes was not enough and reported a failure that was
# really a stopwatch.
for _ in $(seq 1 150); do
  sleep 2
  if curl -s -o /dev/null "http://127.0.0.1:$PORT/api/ping"; then break; fi
done

if curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/ping" | grep -q 200; then
  say PASS "backend answers /api/ping on port $PORT"
  REPORTED=$(curl -s "http://127.0.0.1:$PORT/api/updates/check" \
             | grep -oE '"current_version":"[^"]+"' | cut -d'"' -f4)
  say INFO "the running app reports version $REPORTED"
  CODE=$(curl -s -o "$WORK/index.html" -w '%{http_code}' "http://127.0.0.1:$PORT/")
  BYTES=$(stat -c%s "$WORK/index.html" 2>/dev/null || echo 0)
  if [ "$CODE" = "200" ] && [ "$BYTES" -gt 1000 ]; then
    say PASS "it serves its own frontend ($BYTES bytes)"
  else
    say FAIL "frontend request returned $CODE, $BYTES bytes"
  fi
else
  say FAIL "backend never answered; last lines of its log:"
  tail -20 "$WORK/run.log"
fi

kill "$APP_PID" 2>/dev/null
sleep 2
kill -9 "$APP_PID" 2>/dev/null

echo
echo "=== remove again ==="
dpkg -r smaran-ai >/dev/null 2>&1
if dpkg -s smaran-ai >/dev/null 2>&1; then
  say FAIL "package is still installed after removal"
else
  say PASS "removed cleanly; nothing left behind in dpkg"
fi
[ -e /usr/bin/smaran-ai ] && say FAIL "/usr/bin/smaran-ai survived removal" \
                          || say PASS "/usr/bin/smaran-ai is gone"
