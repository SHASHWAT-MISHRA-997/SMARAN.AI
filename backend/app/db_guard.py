"""Keeping the conversation store readable, and getting it back when it is not.

On 31 August at 03:24 this database became malformed. The app noticed - three
migrations logged "database disk image is malformed" and carried on - and then
did nothing else about it, because there was nothing else to do: no copy of the
file existed anywhere, so there was nothing to go back to. The repair after the
fact was by hand, and the copy that ended up installed was the one with the
sessions but none of the messages.

Two things were missing and both are here now:

*A check.* SQLite will happily open a file whose pages are damaged and only
fail when something reads the wrong one, which is how a broken store gets to
look like an empty one. `quick_check` asks the question up front.

*A copy.* Taken through SQLite's own backup API rather than by copying bytes:
a WAL database on disk is a pair of files, and copying just the .db while the
app is running captures a version of the data that is missing whatever is still
in the write-ahead log. The API takes a consistent snapshot of both.

What this is not: it is not a fix for whatever damaged the file. That cause is
not known - it was not the installer, which never touches this folder, and the
log shows a clean shutdown four minutes earlier. This does not pretend to
prevent it. It means that when it happens again the answer is a copy from a few
hours ago instead of nothing at all.
"""

from __future__ import annotations

import logging
import os
import shutil
import sqlite3
import time
from datetime import datetime

logger = logging.getLogger(__name__)

#: How many snapshots to keep. Small files - the store is well under a
#: megabyte - so this is days of history for the price of one photograph.
KEEP = 8


def _database_path(url: str) -> str | None:
    """The file behind a SQLAlchemy URL, or None if it is not a local file."""
    if not url.startswith("sqlite"):
        return None
    # sqlite:///C:/path/file.db  and  sqlite:////abs/path
    _, _, tail = url.partition("///")
    tail = tail.split("?", 1)[0]
    return tail or None


def _backup_dir(database: str) -> str:
    path = os.path.join(os.path.dirname(database), "backups")
    os.makedirs(path, exist_ok=True)
    return path


def is_healthy(database: str) -> tuple[bool, str]:
    """Whether the file can be read, and what SQLite said if it cannot.

    `quick_check` rather than `integrity_check`: it finds the damage that
    matters here - unreadable pages - without walking every index, which on a
    startup path is time somebody is waiting through.
    """
    if not os.path.exists(database):
        # Nothing there yet is not damage. A first run has no file.
        return True, "no database yet"
    try:
        connection = sqlite3.connect(database, timeout=30)
        try:
            answer = connection.execute("PRAGMA quick_check").fetchone()[0]
        finally:
            connection.close()
    except sqlite3.DatabaseError as exc:
        return False, str(exc)
    return (answer == "ok"), answer


def take_snapshot(database: str) -> str | None:
    """Copy the store, through SQLite, and drop the oldest ones.

    Returns the file written, or None if it could not be taken - which is not
    fatal and must never stop the app from starting.
    """
    if not os.path.exists(database):
        return None
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    target = os.path.join(_backup_dir(database), "sqlite-%s.db" % stamp)
    try:
        source = sqlite3.connect(database, timeout=30)
        copy = sqlite3.connect(target)
        try:
            with copy:
                source.backup(copy)
        finally:
            copy.close()
            source.close()
    except Exception as exc:  # noqa: BLE001 - a failed backup is not fatal
        logger.warning("Could not snapshot the database: %s", exc)
        try:
            os.remove(target)
        except OSError:
            pass
        return None

    _prune(_backup_dir(database))
    return target


def _prune(folder: str) -> None:
    snapshots = sorted(
        (f for f in os.listdir(folder) if f.startswith("sqlite-") and f.endswith(".db")),
        reverse=True,
    )
    for stale in snapshots[KEEP:]:
        try:
            os.remove(os.path.join(folder, stale))
        except OSError:
            pass


def newest_good_snapshot(database: str) -> str | None:
    """The most recent snapshot that itself passes the check.

    Checked rather than assumed: restoring one damaged file over another is
    worse than saying nothing could be restored, because it looks like it
    worked.
    """
    folder = _backup_dir(database)
    for name in sorted(os.listdir(folder), reverse=True):
        if not (name.startswith("sqlite-") and name.endswith(".db")):
            continue
        candidate = os.path.join(folder, name)
        ok, _ = is_healthy(candidate)
        if ok:
            return candidate
    return None


def ensure_usable(database_url: str) -> str:
    """Check the store before anything opens it, and restore it if it is broken.

    Returns a short line describing what happened, for the log.

    The damaged file is moved aside, never deleted: it is the only copy of
    whatever was written since the last snapshot, and a later tool may get
    more out of it than SQLite will today.
    """
    database = _database_path(database_url)
    if not database:
        return "not a local sqlite file; nothing to check"

    ok, said = is_healthy(database)
    if ok:
        taken = take_snapshot(database)
        return "database is readable; snapshot %s" % (
            os.path.basename(taken) if taken else "could not be taken")

    logger.error("The conversation store is damaged: %s", said)
    replacement = newest_good_snapshot(database)
    if not replacement:
        return ("database is damaged (%s) and there is no readable snapshot to "
                "restore from; leaving it alone" % said)

    aside = "%s.damaged-%s" % (database, time.strftime("%Y%m%d-%H%M%S"))
    try:
        # The write-ahead log and shared-memory file belong to the old file and
        # must not be left for the restored one to pick up: SQLite would replay
        # a log written against different pages.
        os.replace(database, aside)
        for suffix in ("-wal", "-shm"):
            try:
                os.remove(database + suffix)
            except OSError:
                pass
        shutil.copyfile(replacement, database)
    except OSError as exc:
        return "database is damaged and could not be replaced: %s" % exc

    logger.error("Restored the conversation store from %s. The damaged file is %s",
                 os.path.basename(replacement), os.path.basename(aside))
    return "restored from %s; damaged file kept as %s" % (
        os.path.basename(replacement), os.path.basename(aside))
