"""Read-only: which account owns the installed app's data, and how much.

Analytics scope every count to the logged-in user. This prints the ownership
split so a dashboard of zeros can be checked against who is actually asking.
"""

import os
import sqlite3

APP = os.path.join(os.environ.get("LOCALAPPDATA", ""), "SMARAN.AI", "data")
PATH = os.path.join(APP, "sqlite.db")

uri = "file:" + PATH.replace("\\", "/") + "?mode=ro"
con = sqlite3.connect(uri, uri=True)
cur = con.cursor()

print("-- accounts that are not auto-created device users --")
cur.execute(
    "SELECT id, username, role FROM users "
    "WHERE username NOT LIKE 'device_device_%' ORDER BY id"
)
for row in cur.fetchall():
    print("   ", row)

print()
print("-- rows owned per account --")
for table in ("audit_logs", "user_memory", "chat_sessions", "documents"):
    print(table)
    try:
        cur.execute(
            "SELECT u.id, u.username, COUNT(*) FROM %s t "
            "JOIN users u ON u.id = t.user_id GROUP BY 1, 2 ORDER BY 3 DESC" % table
        )
        for row in cur.fetchall():
            print("   ", row)
    except sqlite3.Error as exc:
        print("    error:", exc)

con.close()
