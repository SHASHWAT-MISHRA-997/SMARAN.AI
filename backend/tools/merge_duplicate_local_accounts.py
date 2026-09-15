"""Reunite the owner's data that was stranded across duplicate local accounts.

Background
----------
The app named itself with Date.now() plus Math.random(), kept only in
localStorage, and the backend created an account per value. Every reinstall,
port change or cleared app data minted a new account, so the previous
conversations, memories and audit rows stayed with an account nobody was any
more. get_current_user now resolves every loopback caller to one owner, which
stops it happening again, but the rows already written are still attached to
the old accounts.

This moves those rows to the owner and removes the emptied duplicates.

Safety
------
- Dry run by default. Pass --apply to write.
- --apply copies the database to sqlite.premerge-<timestamp>.db first.
- Only accounts whose device_fingerprint matches the owner's machine are
  touched. Accounts reached from the network - the paired phone, LAN guests -
  are left alone, as is the admin account and any account with a password.
- Nothing is deleted except account rows that own no remaining data.

Run with the app closed, or SQLite will refuse the write.
"""

import argparse
import os
import shutil
import sqlite3
import sys
import time

APP = os.path.join(os.environ.get("LOCALAPPDATA", ""), "SMARAN.AI", "data")
DB = os.path.join(APP, "sqlite.db")

OWNER_USERNAME = "device_local_default_user"

# Every table that attributes a row to a user. Missing tables are skipped, so
# this stays correct across schema versions.
OWNED_TABLES = (
    "audit_logs", "chat_sessions", "user_memory", "documents",
    "document_chunks", "collections", "paired_devices",
)


def table_exists(cur, name):
    cur.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,))
    return cur.fetchone() is not None


def has_user_id(cur, name):
    cur.execute("PRAGMA table_info(%s)" % name)
    return any(row[1] == "user_id" for row in cur.fetchall())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true",
                    help="actually write; without it nothing is changed")
    args = ap.parse_args()

    if not os.path.exists(DB):
        print("no database at", DB)
        return 1

    if args.apply:
        backup = os.path.join(APP, "sqlite.premerge-%s.db" % time.strftime("%Y%m%d-%H%M%S"))
        shutil.copy2(DB, backup)
        print("backup written to", backup)
        con = sqlite3.connect(DB)
    else:
        con = sqlite3.connect("file:" + DB.replace("\\", "/") + "?mode=ro", uri=True)

    cur = con.cursor()

    cur.execute("SELECT id FROM users WHERE username = ?", (OWNER_USERNAME,))
    row = cur.fetchone()
    if not row:
        print("no owner account named %s; nothing to merge into" % OWNER_USERNAME)
        return 1
    owner_id = row[0]

    # The machine's fingerprint is the one the most accounts share: each of
    # those accounts is one cleared localStorage on this desktop.
    cur.execute(
        "SELECT device_fingerprint, COUNT(*) FROM users "
        "WHERE device_fingerprint IS NOT NULL AND device_fingerprint != '' "
        "GROUP BY 1 ORDER BY 2 DESC LIMIT 1"
    )
    row = cur.fetchone()
    if not row or row[1] < 2:
        print("no duplicated fingerprint; nothing to merge")
        return 0
    fingerprint, shared = row

    cur.execute(
        "SELECT id FROM users WHERE device_fingerprint = ? AND id != ? "
        "AND username LIKE 'device_%' AND password_hash IS NULL AND role != 'admin'",
        (fingerprint, owner_id),
    )
    duplicates = [r[0] for r in cur.fetchall()]

    print("owner            : id %d (%s)" % (owner_id, OWNER_USERNAME))
    print("fingerprint      : %s..." % fingerprint[:32])
    print("duplicate accounts: %d" % len(duplicates))
    if not duplicates:
        return 0

    marks = ",".join("?" * len(duplicates))
    moved_total = 0
    for table in OWNED_TABLES:
        if not table_exists(cur, table) or not has_user_id(cur, table):
            continue
        cur.execute(
            "SELECT COUNT(*) FROM %s WHERE user_id IN (%s)" % (table, marks),
            duplicates,
        )
        n = cur.fetchone()[0]
        if not n:
            continue
        moved_total += n
        print("  %-16s %4d row(s) -> owner" % (table, n))
        if args.apply:
            cur.execute(
                "UPDATE %s SET user_id = ? WHERE user_id IN (%s)" % (table, marks),
                [owner_id] + duplicates,
            )

    print("total rows to move: %d" % moved_total)

    if args.apply:
        cur.execute("DELETE FROM users WHERE id IN (%s)" % marks, duplicates)
        print("removed %d emptied account row(s)" % cur.rowcount)
        con.commit()
        print("done")
    else:
        print()
        print("DRY RUN - nothing was written. Re-run with --apply to do it.")

    con.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
