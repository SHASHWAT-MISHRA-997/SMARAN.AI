"""Settings -> Memory switches decide what is saved and searched."""
import pytest

from app import memory_prefs


@pytest.fixture(autouse=True)
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(memory_prefs.settings, "DATA_DIR", str(tmp_path))


def test_defaults_search_and_generate_but_skip_sensitive():
    assert memory_prefs.load() == {"search_chats": True, "generate": True, "sensitive": False}
    assert memory_prefs.may_save("I prefer TypeScript for frontends")
    assert not memory_prefs.may_save("I have diabetes and take medication")
    assert not memory_prefs.may_save("My religion is Hindu")


def test_generation_off_saves_nothing():
    memory_prefs.save({"generate": False})
    assert not memory_prefs.may_save("I prefer TypeScript")


def test_sensitive_on_allows_it():
    memory_prefs.save({"sensitive": True})
    assert memory_prefs.may_save("I have diabetes")


def test_background_extraction_obeys_the_switch(monkeypatch, tmp_path):
    import asyncio
    from app import main
    saved = []

    class FakeQuery:
        def filter(self, *a, **k): return self
        def all(self): return []

    class FakeDB:
        def query(self, *a): return FakeQuery()
        def add(self, row): saved.append(row.fact)
        def commit(self): pass
        def close(self): pass
        def rollback(self): pass

    monkeypatch.setattr(main, "SessionLocal", lambda: FakeDB())
    memory_prefs.save({"generate": False})
    asyncio.run(main._extract_and_save_memory(1, "s", "remember this: I love chess", "ok"))
    assert saved == []
    memory_prefs.save({"generate": True})
    asyncio.run(main._extract_and_save_memory(1, "s", "remember this: I love chess", "ok"))
    assert any("chess" in f for f in saved)
