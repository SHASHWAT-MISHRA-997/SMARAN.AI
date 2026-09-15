"""Read the installed app's database, read-only, and report what it holds.

The desktop app keeps its data in %LOCALAPPDATA%\\SMARAN.AI\\data, which is a
different database from the one in this checkout. Analytics read that one, so
a dashboard of zeros has to be checked against it and not against the
developer's copy.
"""

import os
import sqlite3

APP = os.path.join(os.environ.get("LOCALAPPDATA", ""), "SMARAN.AI", "data")
TABLES = ("audit_logs", "chat_messages", "chat_sessions", "user_memory",
          "documents", "document_chunks", "collections")


def counts(path):
    found = {}
    uri = "file:" + path.replace("\\", "/") + "?mode=ro"
    try:
        con = sqlite3.connect(uri, uri=True)
    except sqlite3.Error as exc:
        return {"__error__": str(exc)[:60]}
    try:
        cur = con.cursor()
        for table in TABLES:
            try:
                cur.execute("SELECT COUNT(*) FROM " + table)
                found[table] = cur.fetchone()[0]
            except sqlite3.Error:
                found[table] = "-"
    finally:
        con.close()
    return found


for name in ("sqlite.db", "sqlite.corrupt.db", "sqlite.repaired.db", "sqlite.clean.db"):
    path = os.path.join(APP, name)
    if not os.path.exists(path):
        continue
    size = os.path.getsize(path)
    print("%-22s %8d bytes  %s" % (name, size, counts(path)))
