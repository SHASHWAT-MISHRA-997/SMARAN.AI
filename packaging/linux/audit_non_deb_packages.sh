#!/usr/bin/env bash
# Audit Linux non-deb packages: tar.gz, rpm, and AppImage on real Linux (WSL Ubuntu).
set -u

WORK=/var/tmp/smaran-non-deb-audit
BASE_URL="https://github.com/SHASHWAT-MISHRA-997/SMARAN.AI-downloads/releases/latest/download"

say() { printf '%-4s %s\n' "$1" "$2"; }

rm -rf "$WORK"
mkdir -p "$WORK"
cd "$WORK" || exit 1

echo "========================================="
echo "=== 1. AUDITING .tar.gz (PORTABLE) ==="
echo "========================================="
echo "Downloading smaran-ai-linux-x86_64.tar.gz..."
curl -sL -o smaran.tar.gz "$BASE_URL/smaran-ai-linux-x86_64.tar.gz" || { say FAIL "tar.gz download"; exit 1; }
TAR_SIZE=$(stat -c%s smaran.tar.gz)
say PASS "downloaded tar.gz ($TAR_SIZE bytes)"
sha256sum smaran.tar.gz

mkdir -p "$WORK/tar_extracted"
tar -xzf smaran.tar.gz -C "$WORK/tar_extracted"
TAR_BIN=$(find "$WORK/tar_extracted" -type f -name "smaran-ai" -perm -111 | head -n 1)
if [ -n "$TAR_BIN" ]; then
  say PASS "found executable binary in tar.gz at $TAR_BIN"
  PORT=3011
  BROWSER=true PORT=$PORT nohup "$TAR_BIN" >"$WORK/tar_run.log" 2>&1 &
  TAR_PID=$!
  for _ in $(seq 1 60); do
    sleep 2
    if curl -s -o /dev/null "http://127.0.0.1:$PORT/api/ping"; then break; fi
  done
  if curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/ping" | grep -q 200; then
    say PASS "tar.gz binary answers /api/ping on port $PORT"
  else
    say FAIL "tar.gz binary failed to answer ping; log:"
    tail -n 20 "$WORK/tar_run.log"
  fi
  kill "$TAR_PID" 2>/dev/null || true
  sleep 1
  kill -9 "$TAR_PID" 2>/dev/null || true
else
  say FAIL "smaran-ai binary not found in tar.gz"
fi

echo
echo "========================================="
echo "=== 2. AUDITING .rpm PACKAGE ==="
echo "========================================="
echo "Downloading smaran-ai.x86_64.rpm..."
curl -sL -o smaran.rpm "$BASE_URL/smaran-ai.x86_64.rpm" || { say FAIL "rpm download"; exit 1; }
RPM_SIZE=$(stat -c%s smaran.rpm)
say PASS "downloaded rpm ($RPM_SIZE bytes)"
sha256sum smaran.rpm

mkdir -p "$WORK/rpm_extracted"
cd "$WORK/rpm_extracted" || exit 1
rpm2cpio "$WORK/smaran.rpm" | cpio -idmv >"$WORK/rpm_files.txt" 2>&1
RPM_BIN=$(find "$WORK/rpm_extracted" -type f -name "smaran-ai" -perm -111 | head -n 1)
if [ -n "$RPM_BIN" ]; then
  say PASS "rpm unpacked successfully; found binary at $RPM_BIN"
  PORT=3012
  BROWSER=true PORT=$PORT nohup "$RPM_BIN" >"$WORK/rpm_run.log" 2>&1 &
  RPM_PID=$!
  for _ in $(seq 1 60); do
    sleep 2
    if curl -s -o /dev/null "http://127.0.0.1:$PORT/api/ping"; then break; fi
  done
  if curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/ping" | grep -q 200; then
    say PASS "rpm binary answers /api/ping on port $PORT"
  else
    say FAIL "rpm binary failed to answer ping; log:"
    tail -n 20 "$WORK/rpm_run.log"
  fi
  kill "$RPM_PID" 2>/dev/null || true
  sleep 1
  kill -9 "$RPM_PID" 2>/dev/null || true
else
  say FAIL "rpm did not contain executable smaran-ai binary"
fi
cd "$WORK" || exit 1

echo
echo "========================================="
echo "=== 3. AUDITING .AppImage ==="
echo "========================================="
echo "Downloading SMARAN.AI-x86_64.AppImage..."
curl -sL -o smaran.AppImage "$BASE_URL/SMARAN.AI-x86_64.AppImage" || { say FAIL "AppImage download"; exit 1; }
AI_SIZE=$(stat -c%s smaran.AppImage)
say PASS "downloaded AppImage ($AI_SIZE bytes)"
sha256sum smaran.AppImage

chmod +x smaran.AppImage
./smaran.AppImage --appimage-extract >/dev/null 2>&1 || true
if [ -d "$WORK/squashfs-root" ]; then
  say PASS "AppImage extracted successfully via --appimage-extract"
  APP_RUN="$WORK/squashfs-root/AppRun"
  if [ -f "$APP_RUN" ]; then
    say PASS "AppRun found at $APP_RUN"
    PORT=3013
    BROWSER=true PORT=$PORT nohup "$APP_RUN" >"$WORK/appimage_run.log" 2>&1 &
    AI_PID=$!
    for _ in $(seq 1 60); do
      sleep 2
      if curl -s -o /dev/null "http://127.0.0.1:$PORT/api/ping"; then break; fi
    done
    if curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/ping" | grep -q 200; then
      say PASS "AppImage answers /api/ping on port $PORT"
    else
      say FAIL "AppImage failed to answer ping; log:"
      tail -n 20 "$WORK/appimage_run.log"
    fi
    kill "$AI_PID" 2>/dev/null || true
    sleep 1
    kill -9 "$AI_PID" 2>/dev/null || true
  fi
else
  say FAIL "AppImage extraction failed"
fi

echo
say PASS "All non-deb Linux package audits completed."
