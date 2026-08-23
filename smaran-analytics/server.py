"""
SMARAN.AI — Usage Analytics (developer only)
============================================

A private dashboard showing how the software is actually being used: how many
installations exist, how many are active, how people sign in, on which
platforms and versions, and how that changes over time.

This is deliberately NOT shipped to users. Run it yourself:

    pip install fastapi uvicorn
    python server.py

then open http://127.0.0.1:9000

WHAT IS COLLECTED
-----------------
Only what is needed to count usage:

  * a random installation id generated on the device (not a person, not an
    account, and not derived from any hardware identifier)
  * platform (windows / android / ...), app version
  * event names: install, launch, signup, login, google_signin, heartbeat
  * the time the event arrived

WHAT IS NOT COLLECTED
---------------------
Conversations, prompts, files, file names, model keys, email addresses,
names, IP-derived location, or anything typed into the app. Those are the
user's, and collecting them without asking would be both wrong and, under
India's DPDP Act 2023 and the GDPR, unlawful. The app also shows a notice and
offers a switch to turn reporting off; honour it.

INGEST KEY
----------
Set ANALYTICS_INGEST_KEY to the same value the app is built with, otherwise
anyone who finds the URL can post junk into your numbers.
"""

from __future__ import annotations

import os
import sqlite3
import secrets
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field
import uvicorn

BASE_DIR = Path(__file__).resolve().parent

# The database and the ingest key live wherever ANALYTICS_DB points, which on a
# hosted deployment is a mounted volume. Writing them beside the code instead
# would put them inside the container layer, and every redeploy would quietly
# discard the entire history.
DB_PATH = Path(os.getenv("ANALYTICS_DB") or (BASE_DIR / "analytics.db"))
DB_PATH.parent.mkdir(parents=True, exist_ok=True)

KEY_FILE = DB_PATH.parent / "ingest-key.txt"


def ingest_key() -> str:
    configured = os.getenv("ANALYTICS_INGEST_KEY", "").strip()
    if configured:
        return configured
    if KEY_FILE.exists():
        return KEY_FILE.read_text(encoding="utf-8").strip()
    generated = secrets.token_urlsafe(24)
    KEY_FILE.write_text(generated, encoding="utf-8")
    return generated


# Only these event names are stored. An unknown name is rejected rather than
# recorded, so a stray or malicious client cannot invent categories.
ALLOWED_EVENTS = {
    "install",       # first ever launch on this device
    "launch",        # app opened
    "heartbeat",     # still running
    "signup",        # account created with email and password
    "login",         # signed in with email and password
    "google_signin", # signed in with Google
    "signout",
}

ALLOWED_PLATFORMS = {"windows", "macos", "linux", "android", "ios", "unknown"}


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with closing(connect()) as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS events (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                install_id    TEXT NOT NULL,
                event         TEXT NOT NULL,
                platform      TEXT NOT NULL DEFAULT 'unknown',
                app_version   TEXT NOT NULL DEFAULT 'unknown',
                os_version    TEXT,
                received_at   TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS ix_events_install ON events(install_id);
            CREATE INDEX IF NOT EXISTS ix_events_event   ON events(event);
            CREATE INDEX IF NOT EXISTS ix_events_time    ON events(received_at);

            CREATE TABLE IF NOT EXISTS installs (
                install_id   TEXT PRIMARY KEY,
                platform     TEXT NOT NULL DEFAULT 'unknown',
                app_version  TEXT NOT NULL DEFAULT 'unknown',
                os_version   TEXT,
                first_seen   TEXT NOT NULL,
                last_seen    TEXT NOT NULL,
                launches     INTEGER NOT NULL DEFAULT 0
            );
            """
        )
        conn.commit()


app = FastAPI(title="SMARAN.AI Analytics", docs_url=None, redoc_url=None)


class Event(BaseModel):
    install_id: str = Field(..., min_length=8, max_length=64)
    event: str = Field(..., min_length=2, max_length=32)
    platform: str = Field("unknown", max_length=16)
    app_version: str = Field("unknown", max_length=32)
    os_version: Optional[str] = Field(None, max_length=64)


def require_key(x_ingest_key: str = Header(default="")) -> None:
    if not secrets.compare_digest(x_ingest_key, ingest_key()):
        raise HTTPException(status_code=401, detail="Bad ingest key.")


@app.post("/ingest")
def ingest(event: Event, _: None = Depends(require_key)):
    """Record one event from an installation."""
    name = event.event.strip().lower()
    if name not in ALLOWED_EVENTS:
        raise HTTPException(status_code=400, detail=f"'{name}' is not a recorded event.")
    platform = event.platform.strip().lower()
    if platform not in ALLOWED_PLATFORMS:
        platform = "unknown"

    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    with closing(connect()) as conn:
        conn.execute(
            "INSERT INTO events (install_id, event, platform, app_version, os_version, received_at)"
            " VALUES (?,?,?,?,?,?)",
            (event.install_id, name, platform, event.app_version, event.os_version, now),
        )
        existing = conn.execute(
            "SELECT install_id, launches FROM installs WHERE install_id = ?", (event.install_id,)
        ).fetchone()
        if existing:
            conn.execute(
                "UPDATE installs SET last_seen = ?, platform = ?, app_version = ?, os_version = ?,"
                " launches = launches + ? WHERE install_id = ?",
                (now, platform, event.app_version, event.os_version,
                 1 if name == "launch" else 0, event.install_id),
            )
        else:
            conn.execute(
                "INSERT INTO installs (install_id, platform, app_version, os_version,"
                " first_seen, last_seen, launches) VALUES (?,?,?,?,?,?,?)",
                (event.install_id, platform, event.app_version, event.os_version, now, now,
                 1 if name == "launch" else 0),
            )
        conn.commit()
    return {"recorded": True}


def _since(days: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat(timespec="seconds")


def _window(days: int, start: Optional[str], end: Optional[str]) -> tuple[str, str, int]:
    """Resolve the reporting window.

    Either an explicit start/end pair, or a rolling number of days. Explicit
    dates win, so any month or year can be looked at rather than only the last
    week, month or quarter.
    """
    if start or end:
        begin = f"{start}T00:00:00+00:00" if start else _since(3650)
        finish = f"{end}T23:59:59+00:00" if end else datetime.now(timezone.utc).isoformat(timespec="seconds")
        try:
            span = max(1, (datetime.fromisoformat(finish) - datetime.fromisoformat(begin)).days)
        except ValueError:
            span = days
        return begin, finish, span
    return _since(days), datetime.now(timezone.utc).isoformat(timespec="seconds"), days


@app.get("/api/summary")
def summary(
    days: int = Query(30, ge=1, le=3650),
    start: Optional[str] = Query(None, description="YYYY-MM-DD"),
    end: Optional[str] = Query(None, description="YYYY-MM-DD"),
):
    """Headline numbers, their breakdowns, and the change against last period."""
    begin, finish, span = _window(days, start, end)
    prior_begin = (datetime.fromisoformat(begin) - timedelta(days=span)).isoformat(timespec="seconds")

    with closing(connect()) as conn:
        total_installs = conn.execute("SELECT COUNT(*) c FROM installs").fetchone()["c"]
        active_24h = conn.execute(
            "SELECT COUNT(*) c FROM installs WHERE last_seen >= ?", (_since(1),)
        ).fetchone()["c"]
        active_7d = conn.execute(
            "SELECT COUNT(*) c FROM installs WHERE last_seen >= ?", (_since(7),)
        ).fetchone()["c"]
        new_in_window = conn.execute(
            "SELECT COUNT(*) c FROM installs WHERE first_seen >= ? AND first_seen <= ?",
            (begin, finish),
        ).fetchone()["c"]
        new_previous = conn.execute(
            "SELECT COUNT(*) c FROM installs WHERE first_seen >= ? AND first_seen < ?",
            (prior_begin, begin),
        ).fetchone()["c"]

        counts = {
            row["event"]: row["c"]
            for row in conn.execute(
                "SELECT event, COUNT(*) c FROM events WHERE received_at >= ? AND received_at <= ?"
                " GROUP BY event",
                (begin, finish),
            )
        }
        platforms = {
            row["platform"]: row["c"]
            for row in conn.execute("SELECT platform, COUNT(*) c FROM installs GROUP BY platform")
        }
        versions = {
            row["app_version"]: row["c"]
            for row in conn.execute(
                "SELECT app_version, COUNT(*) c FROM installs GROUP BY app_version"
                " ORDER BY c DESC LIMIT 12"
            )
        }
        daily = [
            {"day": row["day"], "installs": row["installs"], "launches": row["launches"]}
            for row in conn.execute(
                "SELECT substr(received_at,1,10) day,"
                " SUM(event='install') installs, SUM(event='launch') launches"
                " FROM events WHERE received_at >= ? AND received_at <= ?"
                " GROUP BY day ORDER BY day",
                (begin, finish),
            )
        ]

    previous = {}
    with closing(connect()) as conn:
        for row in conn.execute(
            "SELECT event, COUNT(*) c FROM events WHERE received_at >= ? AND received_at < ?"
            " GROUP BY event",
            (prior_begin, begin),
        ):
            previous[row["event"]] = row["c"]

    def change(now_value: int, was: int) -> Optional[float]:
        """Percentage change, or None when there is nothing to compare to."""
        if not was:
            return None
        return round((now_value - was) / was * 100, 1)

    return {
        "window_days": span,
        "window_start": begin[:10],
        "window_end": finish[:10],
        "trend": {
            "new_installs": change(new_in_window, new_previous),
            "launches": change(counts.get("launch", 0), previous.get("launch", 0)),
            "signups": change(counts.get("signup", 0), previous.get("signup", 0)),
            "logins": change(counts.get("login", 0), previous.get("login", 0)),
            "google_signins": change(counts.get("google_signin", 0), previous.get("google_signin", 0)),
        },
        "total_installs": total_installs,
        "active_24h": active_24h,
        "active_7d": active_7d,
        "new_installs": new_in_window,
        "signups": counts.get("signup", 0),
        "logins": counts.get("login", 0),
        "google_signins": counts.get("google_signin", 0),
        "launches": counts.get("launch", 0),
        "platforms": platforms,
        "versions": versions,
        "daily": daily,
    }


@app.get("/api/installs")
def installs(limit: int = Query(100, ge=1, le=1000)):
    """The installation list, newest first. Ids are random, not identities."""
    with closing(connect()) as conn:
        rows = conn.execute(
            "SELECT install_id, platform, app_version, os_version, first_seen, last_seen, launches"
            " FROM installs ORDER BY last_seen DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return {"installs": [dict(row) for row in rows]}


@app.get("/api/recent")
def recent(limit: int = Query(120, ge=1, le=1000)):
    with closing(connect()) as conn:
        rows = conn.execute(
            "SELECT install_id, event, platform, app_version, received_at"
            " FROM events ORDER BY id DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return {"events": [dict(row) for row in rows]}


@app.get("/")
def dashboard():
    return FileResponse(BASE_DIR / "dashboard.html")


@app.get("/key")
def show_key():
    """Printed once so it can be pasted into the app build."""
    return JSONResponse({"ingest_key": ingest_key()})


if __name__ == "__main__":
    init_db()
    port = int(os.getenv("PORT") or os.getenv("ANALYTICS_PORT", "9000"))
    print("=" * 62)
    print(" SMARAN.AI Analytics — developer dashboard")
    print(f"   dashboard : http://127.0.0.1:{port}")
    print(f"   ingest key: {ingest_key()}")
    print("   Build the app with SMARAN_ANALYTICS_KEY set to that key.")
    print("=" * 62)
    uvicorn.run(app, host=os.getenv("ANALYTICS_HOST", "127.0.0.1"), port=port, log_level="warning")
