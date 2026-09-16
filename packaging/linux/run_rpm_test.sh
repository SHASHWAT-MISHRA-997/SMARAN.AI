#!/bin/bash
echo "== Testing RPM binary execution =="
RPM_BIN="/var/tmp/smaran-non-deb-audit/rpm_extracted/opt/smaran-ai/SMARAN.AI"
chmod +x "$RPM_BIN"
kill -9 $(pgrep -f "SMARAN.AI") 2>/dev/null || true
sleep 1

"$RPM_BIN" > /var/tmp/rpm_run.log 2>&1 &
echo "Launched RPM binary in background..."

READY=0
for i in $(seq 1 45); do
    if curl -s -m 2 http://127.0.0.1:3003/api/ping | grep -q '"status":"ok"'; then
        echo "RPM server is UP and responding after $i seconds!"
        READY=1
        break
    fi
    sleep 1
done

if [ "$READY" -eq 1 ]; then
    echo "--- /api/ping response ---"
    curl -s http://127.0.0.1:3003/api/ping
    echo ""
    echo "--- / response head ---"
    curl -s http://127.0.0.1:3003/ | head -n 5
    echo ""
    echo "RPM test SUCCESSFUL!"
    kill -9 $(pgrep -f "SMARAN.AI") 2>/dev/null || true
    exit 0
else
    echo "RPM test FAILED to respond within timeout. Log tail:"
    tail -n 25 /var/tmp/rpm_run.log
    kill -9 $(pgrep -f "SMARAN.AI") 2>/dev/null || true
    exit 1
fi
