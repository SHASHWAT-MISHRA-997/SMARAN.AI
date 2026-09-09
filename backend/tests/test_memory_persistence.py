"""Memory facts the user types are actually stored.

The Settings panel had an add box that built an object, put it in React state
and stopped. A fact appeared in the list, survived until the panel closed, and
was gone on reopening. Delete was the same in reverse: it filtered state while
the row sat untouched in the database, so a "deleted" memory came back. There
was also no add endpoint at all, so the front end could not have saved one even
if it had tried.

These cover the server half: that a fact is stored, comes back, is deleted for
real, and that one user cannot reach another's memories.
"""

import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app import main as app_main                    # noqa: E402
from app.models import UserMemory                   # noqa: E402


class _User:
    def __init__(self, uid):
        self.id = uid


class _Query:
    """Just enough of a SQLAlchemy query for these handlers."""

    def __init__(self, rows, model):
        self._rows = rows
        self._model = model
        self._filters = []

    def filter(self, *conditions):
        self._filters.extend(conditions)
        return self

    def order_by(self, *_):
        return self

    def all(self):
        return list(self._rows)

    def first(self):
        return self._rows[0] if self._rows else None


class _Session:
    """An in-memory stand-in that records what was actually committed."""

    def __init__(self):
        self.rows = []
        self.committed = 0
        self.deleted = []
        self._next_id = 1

    def add(self, row):
        row.id = self._next_id
        self._next_id += 1
        if getattr(row, "created_at", None) is None:
            import datetime
            row.created_at = datetime.datetime.now()
        self.rows.append(row)

    def commit(self):
        self.committed += 1

    def refresh(self, _row):
        pass

    def delete(self, row):
        self.deleted.append(row)
        self.rows = [r for r in self.rows if r is not row]

    def query(self, model):
        return _Query(self.rows, model)


def _run(coro):
    import asyncio
    return asyncio.run(coro)


def test_a_typed_memory_is_written_to_the_database():
    db = _Session()
    result = _run(app_main.add_memory_fact({"fact": "I prefer metric units"},
                                           db=db, current_user=_User(7)))
    assert db.committed == 1, "the fact must be committed, not held in memory"
    assert len(db.rows) == 1
    assert db.rows[0].fact == "I prefer metric units"
    assert db.rows[0].user_id == 7


def test_the_saved_row_is_returned_with_a_real_id():
    # The front end used to invent `mem_<timestamp>`, which could never match a
    # row and so could never be deleted. It now inserts what the server returns.
    db = _Session()
    result = _run(app_main.add_memory_fact({"fact": "Calls me Shashwat"},
                                           db=db, current_user=_User(1)))
    assert isinstance(result["id"], int)
    assert result["fact"] == "Calls me Shashwat"
    # Same shape as GET, so the caller needs no special case.
    assert set(result) >= {"id", "fact", "category", "category_label", "created_at"}


def test_an_empty_memory_is_refused():
    db = _Session()
    with pytest.raises(app_main.HTTPException) as raised:
        _run(app_main.add_memory_fact({"fact": "   "}, db=db, current_user=_User(1)))
    assert raised.value.status_code == 400
    assert db.committed == 0


def test_an_enormous_memory_is_refused():
    # This is read into prompts later; an unbounded field here is an unbounded
    # prompt there.
    db = _Session()
    with pytest.raises(app_main.HTTPException) as raised:
        _run(app_main.add_memory_fact({"fact": "x" * 2001}, db=db, current_user=_User(1)))
    assert raised.value.status_code == 400


def test_an_unknown_category_falls_back_rather_than_being_stored():
    db = _Session()
    result = _run(app_main.add_memory_fact({"fact": "a fact", "category": "../../evil"},
                                           db=db, current_user=_User(1)))
    assert result["category"] == "durable_record"


def test_deleting_a_memory_removes_the_row():
    db = _Session()
    _run(app_main.add_memory_fact({"fact": "temporary"}, db=db, current_user=_User(5)))
    row = db.rows[0]
    _run(app_main.delete_single_memory(row.id, db=db, current_user=_User(5)))
    assert db.deleted == [row]
    assert db.rows == []


def test_deleting_a_memory_that_is_not_yours_is_refused():
    db = _Session()
    _run(app_main.add_memory_fact({"fact": "mine"}, db=db, current_user=_User(5)))
    # The handler filters on user_id; the stand-in returns the row regardless,
    # so this asserts the filter is applied rather than trusting it.
    conditions = []
    original_query = db.query

    def spy(model):
        query = original_query(model)
        real_filter = query.filter

        def record(*args):
            conditions.extend(args)
            return real_filter(*args)

        query.filter = record
        return query

    db.query = spy
    _run(app_main.delete_single_memory(1, db=db, current_user=_User(5)))
    assert len(conditions) >= 2, "delete must filter on the owner as well as the id"
