"""Start a specified release in isolated project data and verify HTTP readiness."""
import argparse
import json
import os
from pathlib import Path
import signal
import subprocess
import time
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument('binary', type=Path)
parser.add_argument('--name', required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
binary = args.binary.resolve()
assert binary.is_relative_to(root) and binary.is_file()
assert args.name.replace('-', '').isalnum()
audit = root / '.cache/audit'
data = audit / (args.name + '-runtime')
data.mkdir(parents=True, exist_ok=True)
env = dict(os.environ, DATA_DIR=str(data), BROWSER='/bin/true',
           HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1')
result = {'binary': str(binary), 'passed': False}
started = time.monotonic()
with (audit / (args.name + '-startup.log')).open('w', encoding='utf-8') as log:
    process = subprocess.Popen([str(binary)], cwd=root, env=env, stdout=log,
                               stderr=subprocess.STDOUT, start_new_session=os.name != 'nt')
    try:
        while time.monotonic() - started < 110 and process.poll() is None:
            try:
                record = json.loads((data / 'runtime.json').read_text())
                base = f"http://127.0.0.1:{int(record['port'])}"
                with urllib.request.urlopen(base + '/health', timeout=3) as response:
                    result['health'] = json.load(response)
                with urllib.request.urlopen(base + '/', timeout=3) as response:
                    result['frontend'] = 'id="root"' in response.read().decode()
                result['passed'] = result['frontend']
                result['ready_seconds'] = round(time.monotonic() - started, 2)
                break
            except (OSError, ValueError):
                time.sleep(1)
    finally:
        if process.poll() is None:
            if os.name == 'nt':
                process.terminate()
            else:
                os.killpg(process.pid, signal.SIGTERM)
            process.wait(timeout=15)
(audit / (args.name + '-result.json')).write_text(json.dumps(result, indent=2), encoding='utf-8')
print(json.dumps(result))
raise SystemExit(0 if result['passed'] else 1)
