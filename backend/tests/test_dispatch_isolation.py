"""Dispatch must never route a foreign/missing device ID to another account."""
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient
from app import companion


def test_unknown_target_returns_404_without_falling_back_to_another_phone():
    class DevicesQuery:
        scoped = False

        def filter(self, *args):
            self.scoped = True
            return self

        def first(self):
            return None if self.scoped else SimpleNamespace(id='foreign-phone', name='Other account')

    class Database:
        def query(self, *args):
            return DevicesQuery()

    app = FastAPI()
    app.include_router(companion.router)
    app.dependency_overrides[companion.get_db] = lambda: Database()
    app.dependency_overrides[companion.get_current_user_dep] = lambda: SimpleNamespace(id=1)
    response = TestClient(app).post('/api/companion/dispatch', json={
        'device_id': 'not-owned', 'action': 'prompt', 'data': {'prompt': 'Private task'},
    })
    assert response.status_code == 404
    assert 'foreign-phone' not in companion._command_queues


def test_dispatch_rejects_actions_outside_the_remote_allow_list():
    class Database:
        def query(self, *args):
            raise AssertionError('an invalid action must be rejected before querying devices')

    app = FastAPI()
    app.include_router(companion.router)
    app.dependency_overrides[companion.get_db] = lambda: Database()
    app.dependency_overrides[companion.get_current_user_dep] = lambda: SimpleNamespace(id=1)
    response = TestClient(app).post('/api/companion/dispatch', json={
        'device_id': 'all', 'action': 'run_arbitrary_code', 'data': {},
    })
    assert response.status_code == 400
    assert 'not a permitted remote action' in response.json()['detail']


def test_dispatch_all_returns_404_when_the_account_has_no_devices():
    class DevicesQuery:
        def filter(self, *args):
            return self

        def all(self):
            return []

    class Database:
        def query(self, *args):
            return DevicesQuery()

    app = FastAPI()
    app.include_router(companion.router)
    app.dependency_overrides[companion.get_db] = lambda: Database()
    app.dependency_overrides[companion.get_current_user_dep] = lambda: SimpleNamespace(id=1)
    response = TestClient(app).post('/api/companion/dispatch', json={
        'device_id': 'all', 'action': 'prompt', 'data': {'prompt': 'Private task'},
    })
    assert response.status_code == 404
    assert response.json()['detail'] == 'No paired devices found.'
