"""Behaviour regressions for automations, gateways and saved checkpoints."""
import asyncio
from datetime import datetime
import sys
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.agent import scheduler
from app.agent.sandbox import Sandbox
from app.gateway.telegram_bot import TelegramGateway
from app.gateway.discord_bot import DiscordGateway


@pytest.mark.parametrize('expression', ['nonsense', 'every 0 minutes', 'every 0 hours',
    '*/0 * * * *', '60 * * * *', '* 25 * * *', '0 0 31 2 *', 'daily at 25:00'])
def test_bad_schedules_are_rejected(expression):
    with pytest.raises(ValueError):
        scheduler._parse_schedule_to_next_ts(expression)


@pytest.mark.parametrize('expression,base,expected', [
    ('0 9 * * 1', datetime(2026, 9, 14, 10), datetime(2026, 9, 21, 9)),
    ('0 9 * * 7', datetime(2026, 9, 14, 10), datetime(2026, 9, 20, 9)),
    ('0 0 1 1 *', datetime(2026, 9, 14), datetime(2027, 1, 1)),
    ('0 0 29 2 *', datetime(2026, 9, 14), datetime(2028, 2, 29)),
    ('daily', datetime(2026, 9, 14, 8), datetime(2026, 9, 14, 9)),
    ('0 9 15 * 1', datetime(2026, 9, 14, 10), datetime(2026, 9, 15, 9)),
    ('5-15/5 * * * *', datetime(2026, 9, 14, 9, 6), datetime(2026, 9, 14, 9, 10)),
])
def test_next_occurrence(expression, base, expected):
    assert scheduler._parse_schedule_to_next_ts(expression, base.timestamp()) == expected.timestamp()


def test_duplicate_runs_are_coalesced(tmp_path, monkeypatch):
    monkeypatch.setattr(scheduler, '_DEFAULT_DB_PATH', tmp_path / 'jobs.db')
    instance = scheduler.AutomationScheduler()
    job = instance.store.add_job('test', 'every 1 hour', 'test')
    async def scenario():
        entered = asyncio.Event()
        finish = asyncio.Event()
        count = 0
        async def execute(job_id):
            nonlocal count
            count += 1
            entered.set()
            await finish.wait()
            return {'status': 'success'}
        monkeypatch.setattr(instance, '_execute_job', execute)
        assert instance.queue_job(job.id)['status'] == 'queued'
        task = instance._active_jobs[job.id]
        await entered.wait()
        assert instance.queue_job(job.id)['status'] == 'running'
        assert (await instance.run_job_now(job.id))['status'] == 'running'
        finish.set()
        await task
        assert count == 1
        assert not instance._active_jobs
    asyncio.run(scenario())


def test_snapshot_prunes_dependencies_and_its_own_storage(tmp_path, monkeypatch):
    monkeypatch.setenv('DATA_DIR', str(tmp_path / 'data'))
    (tmp_path / 'file.txt').write_text('before')
    (tmp_path / 'node_modules').mkdir()
    (tmp_path / 'node_modules' / 'ignore.txt').write_text('dependency')
    sandbox = Sandbox()
    first = sandbox.create_snapshot(str(tmp_path))
    second = sandbox.create_snapshot(str(tmp_path))
    assert set(first.file_checksums) == {'file.txt'}
    assert set(second.file_checksums) == {'file.txt'}
    (tmp_path / 'file.txt').write_text('after')
    assert sandbox.restore_snapshot(first.id)['success']
    assert (tmp_path / 'file.txt').read_text() == 'before'
    assert not sandbox.restore_snapshot('../outside')['success']
    assert not sandbox.delete_snapshot('../outside')
    with pytest.raises(ValueError):
        sandbox.create_snapshot('')


@pytest.mark.parametrize('gateway_type', [TelegramGateway, DiscordGateway])
def test_gateway_failed_auth_closes_client(gateway_type, monkeypatch):
    clients = []
    real_client = httpx.AsyncClient
    def client(**kwargs):
        result = real_client(**kwargs, transport=httpx.MockTransport(
            lambda request: httpx.Response(401, json={'ok': False})))
        clients.append(result)
        return result
    monkeypatch.setattr(httpx, 'AsyncClient', client)
    async def scenario():
        gateway = gateway_type()
        # Well-formed, so it reaches the server and is refused there.
        assert not await gateway.start({'token': '123456789:AAEhBP0av28abcdefghijklmnopqrstuvwxyz',
                                        'default_channel_id': '112233445566778899'})
        assert gateway.last_error
        assert clients[0].is_closed
        assert gateway._client is None
        assert not gateway.is_running()
    asyncio.run(scenario())


@pytest.mark.parametrize('gateway_type', [TelegramGateway, DiscordGateway])
def test_gateway_delivery_failure_is_reported(gateway_type):
    async def scenario():
        gateway = gateway_type()
        gateway.bot_token = 'test'
        gateway._client = httpx.AsyncClient(base_url='https://example.test',
            transport=httpx.MockTransport(lambda request: httpx.Response(403, json={})))
        try:
            assert not await gateway.send_message('123', 'hello')
        finally:
            await gateway.stop()
    asyncio.run(scenario())
