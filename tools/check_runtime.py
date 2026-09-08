"""Exercise the real API on isolated data without model downloads or user keys.

Run from the repository root: python tools/check_runtime.py
"""
import asyncio
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SCRATCH = ROOT / '.cache' / 'audit'
SCRATCH.mkdir(parents=True, exist_ok=True)
data = Path(tempfile.mkdtemp(prefix='runtime-smoke-', dir=SCRATCH))
(data / 'usage-reporting.json').write_text('{"enabled":false}', encoding='utf-8')
os.environ.update(DATA_DIR=str(data), DATABASE_URL=f'sqlite:///{data.as_posix()}/sqlite.db',
                  HF_HOME=str(data / 'models'), NLTK_DATA=str(data / 'nltk'),
                  HF_HUB_OFFLINE='1', ANONYMIZED_TELEMETRY='False')
sys.path.insert(0, str(ROOT / 'backend'))

from app import main
from fastapi.testclient import TestClient

# Startup must neither create a public administrator password nor reset an
# existing account. This is a brand-new database, not the installed store.
with main.SessionLocal() as db:
    assert db.query(main.User).count() == 0, 'Startup unexpectedly seeded a user'

client = TestClient(main.app)
for endpoint in ('/api/lock/status', '/api/plugins', '/api/mcp/servers', '/api/selftest', '/api/workspace/status'):
    response = client.get(endpoint)
    assert response.status_code == 200, (endpoint, response.status_code)
    assert isinstance(response.json(), dict), endpoint
assert client.get('/api/lock/status').json()['enabled'] is False
response = client.post('/api/desktop/intent', json={'text':'do not mute'})
assert response.status_code == 200 and response.json()['detected'] is False

async def verify_lifespan():
    called = []
    def hook(name):
        async def invoke():
            called.append(name)
        return invoke
    with patch.object(main, '_restore_saved_provider_keys', hook('providers')), \
         patch.object(main, '_load_enabled_plugins', hook('plugins')), \
         patch.object(main, '_warm_speech_recognition', hook('speech')), \
         patch.object(main, '_settle_the_database', hook('shutdown')):
        async with main.lifespan(main.app):
            assert called == ['providers', 'plugins', 'speech']
        assert called == ['providers', 'plugins', 'speech', 'shutdown']

asyncio.run(verify_lifespan())

async def verify_gpu_probe_off_event_loop():
    import httpx
    from app import gpu_speech
    event_loop_thread = threading.get_ident()

    def probe():
        assert threading.get_ident() != event_loop_thread, 'GPU probe blocks the API event loop'
        return {'in_use': True, 'detail': 'Test probe'}

    with patch.object(gpu_speech, 'status', probe):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url='http://test') as api:
            assert (await api.get('/api/speech/gpu')).json()['in_use'] is True
            assert (await api.post('/api/speech/gpu/install')).json()['started'] is False

asyncio.run(verify_gpu_probe_off_event_loop())

# API routes registered near the bottom must precede the SPA fallback.
assert client.get('/api/does-not-exist').status_code == 404
assert client.get('/assets/does-not-exist.js').status_code == 404
main.app.dependency_overrides[main.get_current_user] = lambda: object()
try:
    with patch.object(main, '_model_usage', return_value={'audit': 'storage'}), \
         patch.object(main, 'ollama_state', return_value={'audit': 'engine'}):
        assert client.get('/api/models/storage').json() == {'audit': 'storage'}
        assert client.get('/api/models/engine').json() == {'audit': 'engine'}
finally:
    main.app.dependency_overrides.clear()

# A sibling whose name starts with the web root used to pass startswith().
webroot = data / 'frontend'
webroot.mkdir()
(webroot / 'index.html').write_text('audit SPA', encoding='utf-8')
private = data / 'frontend-private'
private.mkdir()
(private / 'secret.txt').write_text('audit sentinel', encoding='utf-8')
with patch.object(main, 'FRONTEND_DIST_DIR', str(webroot)):
    assert client.get('/conversation/123').text == 'audit SPA'
    assert client.get('/..%5cfrontend-private%5csecret.txt').status_code == 404

with patch.object(main.logger, 'exception'):
    failure = asyncio.run(main.global_exception_handler(None, ValueError('private-error-sentinel')))
assert failure.status_code == 500 and b'private-error-sentinel' not in failure.body

# Knowing a session or message ID must not confer access across accounts.
from types import SimpleNamespace
with main.SessionLocal() as db:
    db.add_all([main.User(id=101, username='audit-owner'),
                main.User(id=102, username='audit-other'),
                main.User(id=0, username='audit-legacy')])
    db.flush()
    db.add_all([main.ChatSession(id='private-audit', user_id=101, title='Private'),
                main.ChatSession(id='legacy-audit', user_id=0, title='Legacy')])
    db.flush()
    msg = main.ChatMessage(session_id='private-audit', role='user', content='private sentinel')
    db.add(msg)
    db.commit()
    message_id = msg.id
main.app.dependency_overrides[main.get_current_user] = lambda: SimpleNamespace(id=102, username='audit-other')
try:
    assert client.get('/api/chat/sessions/private-audit/messages').json() == []
    forbidden = [
        client.put('/api/chat/sessions/private-audit', json={'title':'stolen'}),
        client.delete('/api/chat/sessions/private-audit'),
        client.delete('/api/chat/sessions/private-audit/messages'),
        client.delete(f'/api/chat/messages/{message_id}'),
        client.put(f'/api/chat/messages/{message_id}', json={'content':'stolen'}),
        client.post('/api/chat', json={'session_id':'private-audit', 'prompt':'stolen'}),
        client.post('/api/chat/vision', data={'session_id':'private-audit', 'prompt':'stolen'},
                    files={'file':('audit.png', b'not-an-image', 'image/png')}),
    ]
    assert all(r.status_code == 404 for r in forbidden), [r.status_code for r in forbidden]
    assert client.delete('/api/privacy/clear-all').status_code == 200
    with main.SessionLocal() as db:
        session = db.get(main.ChatSession, 'private-audit')
        assert session.user_id == 101 and session.title == 'Private'
        assert db.get(main.ChatMessage, message_id).content == 'private sentinel'
        assert db.get(main.ChatSession, 'legacy-audit').user_id == 0
    main.app.dependency_overrides[main.get_current_user] = lambda: SimpleNamespace(id=101, username='audit-owner')
    assert client.get('/api/chat/sessions/private-audit/messages').json()[0]['content'] == 'private sentinel'
    assert client.put('/api/chat/sessions/private-audit', json={'title':'Renamed'}).status_code == 200
    assert client.delete(f'/api/chat/messages/{message_id}').status_code == 200
    assert client.delete('/api/chat/sessions/private-audit').status_code == 200
finally:
    main.app.dependency_overrides.clear()

client.close()
main.engine.dispose()
print(json.dumps({'api_checks':27, 'chat_account_isolation': True, 'fresh_database_has_no_seeded_admin':True,
                  'gpu_probe_off_event_loop': True,
                  'late_api_routes_and_static_boundaries': True,
                  'lifespan_order_and_shutdown':True, 'test_data':str(data)}))
