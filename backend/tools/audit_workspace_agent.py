"""Exercise real HTTP workspace operations and a local agent on disposable fixtures.

Evidence is written under .cache/audit. Never opens an unrelated workspace or
discards pending edits. Agent requests explicitly select the installed local model.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
from pathlib import Path
import urllib.error
import urllib.parse
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[2]
AUDIT = ROOT / '.cache' / 'audit'
BASE = 'http://127.0.0.1:8000'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--agent', action='store_true')
    args = parser.parse_args()
    stamp = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    fixture = AUDIT / ('live-fixture-' + stamp + '-' + uuid.uuid4().hex[:6])
    fixture.mkdir(parents=True)
    report = {'started_at': stamp, 'fixture': str(fixture), 'checks': []}
    output = AUDIT / ('live-agent-' if args.agent else 'live-workspace-')
    output = output.with_name(output.name + stamp + '.json')

    def save():
        output.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')

    def check(name, condition):
        report['checks'].append({'name': name, 'passed': bool(condition)})
        save()
        print(f'{"PASS" if condition else "FAIL"}: {name}', flush=True)
        if not condition:
            raise AssertionError(name)

    def request(method, path, body=None, expected=200):
        req = urllib.request.Request(BASE + path, method=method,
            data=json.dumps(body).encode() if body is not None else None,
            headers={'Content-Type': 'application/json'})
        try:
            response = urllib.request.urlopen(req, timeout=360)
        except urllib.error.HTTPError as exc:
            response = exc
        with response:
            status = response.code
            data = json.load(response)
        check(f'{method} {path}: HTTP {status} (expected {expected})', status == expected)
        return data

    try:
        if args.agent:
            (fixture / 'calculation.py').write_text('def add(a, b):\n    return a - b\n', encoding='utf-8')
            task = ('In this fixture only, read calculation.py and fix add so it returns a + b. '
                    'Use read_file then edit_file, then read_file to verify the saved content. '
                    'Do not run shell commands, create other files, or access anything outside this folder. '
                    'Finish with a short summary.')
            req = urllib.request.Request(BASE + '/api/agent/run',
                data=json.dumps({'task': task, 'model': 'qwen2.5-coder:7b', 'root': str(fixture)}).encode(),
                headers={'Content-Type': 'application/json'})
            report['events'] = []
            with urllib.request.urlopen(req, timeout=360) as response:
                check('Agent response uses NDJSON', 'application/x-ndjson' in response.headers.get('Content-Type', ''))
                for line in response:
                    if line.strip():
                        event = json.loads(line)
                        report['events'].append(event)
                        save()
                        print('Agent event: ' + event.get('type', 'unknown'), flush=True)
            events = report['events']
            check('Agent stream ends with done', bool(events) and events[-1].get('type') == 'done')
            check('Agent performed read and edit tools', {'read_file', 'edit_file'} <= {e.get('name') for e in events if e.get('type') == 'tool_result'})
            actual = (fixture / 'calculation.py').read_text(encoding='utf-8')
            check('Actual saved function adds operands', actual == 'def add(a, b):\n    return a + b\n')
            report['artifact_sha256'] = hashlib.sha256((fixture / 'calculation.py').read_bytes()).hexdigest()
        else:
            status = request('GET', '/api/workspace/status')
            check('Existing workspace is closed with no pending edits', not status['open'] and not status.get('pending'))
            request('POST', '/api/workspace/open', {'folder': str(fixture)})
            try:
                browse = request('GET', '/api/workspace/browse?path=' + urllib.parse.quote(str(fixture)))
                check('Browse returns structured response', isinstance(browse, dict))
                proposed = request('POST', '/api/workspace/propose/write', {'path': 'note.txt', 'text': 'first\n'})
                check('Proposal does not write before application', not (fixture / 'note.txt').exists())
                pending = request('GET', '/api/workspace/pending')
                check('Pending list contains the exact proposal', any(p['id'] == proposed['id'] for p in pending['pending']))
                request('POST', '/api/workspace/apply', {'id': proposed['id']})
                check('Applied bytes reach disk', (fixture / 'note.txt').read_bytes() == b'first\n')
                content = request('GET', '/api/workspace/file?path=note.txt')
                check('HTTP read returns saved text', content['text'] == 'first\n')
                tree = request('GET', '/api/workspace/tree')
                check('Tree lists created file', any(p['path'] == 'note.txt' for p in tree['entries']))
                request('GET', '/api/workspace/file?path=..%2Foutside.txt', expected=400)
                rejected = request('POST', '/api/workspace/propose/delete', {'path': 'note.txt'})
                request('POST', '/api/workspace/reject', {'id': rejected['id']})
                check('Rejecting deletion preserves fixture', (fixture / 'note.txt').read_bytes() == b'first\n')
                conflict = request('POST', '/api/workspace/propose/write', {'path': 'note.txt', 'text': 'replacement\n'})
                (fixture / 'note.txt').write_text('changed externally\n', encoding='utf-8')
                request('POST', '/api/workspace/apply', {'id': conflict['id']}, expected=400)
                check('Conflict preserves external edit', (fixture / 'note.txt').read_text() == 'changed externally\n')
                pending = request('GET', '/api/workspace/pending')
                check('Conflicting proposal is dropped with its refusal', all(p['id'] != conflict['id'] for p in pending['pending']))
                history = request('GET', '/api/workspace/history')
                check('History records applied fixture edit', any(p['path'] == 'note.txt' for p in history['applied']))
                sibling = fixture / 'note.txt.smaran-tmp'
                sibling.write_bytes(b'pre-existing sibling content\n')
                proposed = request('POST', '/api/workspace/propose/write', {'path': 'note.txt', 'text': 'approved revision\n'})
                request('POST', '/api/workspace/apply', {'id': proposed['id']})
                check('Saving preserves a pre-existing .smaran-tmp sibling', sibling.exists() and sibling.read_bytes() == b'pre-existing sibling content\n')
            finally:
                request('POST', '/api/workspace/close')
            check('Workspace is closed again', request('GET', '/api/workspace/status')['open'] is False)
        report['result'] = 'passed'
    except Exception as exc:
        report['result'] = 'failed'
        report['failure'] = {'type': type(exc).__name__, 'message': str(exc)}
        raise
    finally:
        save()
        print('Evidence: ' + str(output), flush=True)


if __name__ == '__main__':
    main()
