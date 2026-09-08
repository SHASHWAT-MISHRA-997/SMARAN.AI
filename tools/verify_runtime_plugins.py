"""Exercise local plugin capabilities against an isolated SMARAN audit server."""
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
CASES = [
    ('headroom', 'headroom_compress', {'text': 'A   real     compression\n\n\ncheck.'}),
    ('code-risk-scan', 'strix_scan_code', {'code_snippet': 'import subprocess\nsubprocess.run(user_input, shell=True)', 'language': 'python'}),
    ('task-observer', 'observer_review_session', {'messages': 10}),
    ('provider-latency', 'omniroute_get_metrics', {}),
    ('meeting-notes-import', 'meetily_scan', {'folder': str(ROOT / '.cache/audit/runtime-current')}),
    ('hyperframes', 'hyperframes_status', {}),
]
results = []
for plugin, tool, arguments in CASES:
    request = urllib.request.Request(
        f'http://127.0.0.1:3003/api/plugins/{plugin}/tools/{tool}/execute',
        data=json.dumps({'tool_name': tool, 'arguments': arguments}).encode(),
        headers={'Content-Type': 'application/json'},
    )
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            result = json.load(response)
        passed = bool(result.get('success')) and not (isinstance(result.get('result'), dict) and result['result'].get('error'))
        results.append({'plugin': plugin, 'tool': tool, 'passed': passed, 'response': result})
    except Exception as exc:
        results.append({'plugin': plugin, 'tool': tool, 'passed': False, 'error': str(exc)})
    print(plugin, 'PASS' if results[-1]['passed'] else 'FAIL', flush=True)
(ROOT / '.cache/audit/plugin-execution-current.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
raise SystemExit(0 if all(item['passed'] for item in results) else 1)
