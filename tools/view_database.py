"""
SMARAN.AI — Database & User Data Inspector
===========================================

Run this tool to inspect what data is recorded in your local and cloud databases:
    python tools/view_database.py

It displays:
1. Live Netlify Cloud Database (Users, Installs, Google Sign-ins, Web visits)
2. Local Analytics Database (smaran-analytics/analytics.db)
3. Local Backend Database (data/smaran.db / backend/smaran.db)
"""

import os
import sys
import sqlite3
import json
import urllib.request
import urllib.error
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

def print_header(title):
    print("\n" + "=" * 70)
    print(f"  {title}")
    print("=" * 70)

def inspect_cloud_database():
    print_header("1. LIVE CLOUD DATABASE (Netlify Blobs — smaran-analytics.netlify.app)")
    dashboard_key = "OZoUnX6AYRoNs7TP8yY9LMKdsZon10US"
    summary_url = "https://smaran-analytics.netlify.app/api/summary"
    installs_url = "https://smaran-analytics.netlify.app/api/installs"
    
    try:
        req = urllib.request.Request(summary_url, headers={"x-dashboard-key": dashboard_key})
        with urllib.request.urlopen(req, timeout=10) as resp:
            summary_data = json.loads(resp.read().decode("utf-8"))
            print("  Cloud Summary Metrics:")
            print(f"    • Total Installs:   {summary_data.get('total_installs', 0)}")
            print(f"    • Active (24h):     {summary_data.get('active_24h', 0)}")
            print(f"    • Active (7d):      {summary_data.get('active_7d', 0)}")
            print(f"    • Google Sign-ins:  {summary_data.get('google_signins', 0)}")
            print(f"    • App Launches:     {summary_data.get('launches', 0)}")
            print(f"    • Platforms:        {summary_data.get('platforms', {})}")

        req_inst = urllib.request.Request(installs_url, headers={"x-dashboard-key": dashboard_key})
        with urllib.request.urlopen(req_inst, timeout=10) as resp_inst:
            installs_data = json.loads(resp_inst.read().decode("utf-8"))
            installs = installs_data.get("installs", [])
            print(f"\n  Detailed Users / Installs in Store: {len(installs)}")
            if not installs:
                print("    (Currently fresh: 0 installs recorded)")
            else:
                for inst in installs[:20]:
                    uid = inst.get("install_id", "—")
                    plat = inst.get("platform", "—")
                    user = inst.get("user_email") or inst.get("user_name") or "Anonymous"
                    seen = inst.get("last_seen", "—")[:19]
                    print(f"    • [{plat}] {uid} — User: {user} — Last seen: {seen}")
    except Exception as exc:
        print(f"  Could not reach cloud analytics endpoint: {exc}")

def inspect_local_analytics_db():
    print_header("2. LOCAL ANALYTICS DATABASE (smaran-analytics/analytics.db)")
    db_path = BASE_DIR / "smaran-analytics" / "analytics.db"
    if not db_path.exists():
        print(f"  Database file not found at: {db_path}")
        return

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    try:
        # Check tables
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
        tables = [row["name"] for row in cursor.fetchall()]
        print(f"  Database File: {db_path} ({db_path.stat().st_size:,} bytes)")
        print(f"  Tables Found: {', '.join(tables)}\n")

        if "installs" in tables:
            cursor.execute("SELECT COUNT(*) as count FROM installs")
            count = cursor.fetchone()["count"]
            print(f"  Total Installs Recorded: {count}")
            cursor.execute("SELECT * FROM installs ORDER BY last_seen DESC LIMIT 10")
            rows = cursor.fetchall()
            if rows:
                print(f"  Recent Installs:")
                for r in rows:
                    r_dict = dict(r)
                    print(f"    • ID: {r_dict.get('install_id')} | Platform: {r_dict.get('platform')} | Launches: {r_dict.get('launches')} | Last Seen: {r_dict.get('last_seen')}")

        if "events" in tables:
            cursor.execute("SELECT COUNT(*) as count FROM events")
            event_count = cursor.fetchone()["count"]
            print(f"\n  Total Usage Events: {event_count}")
            cursor.execute("SELECT event, COUNT(*) as c FROM events GROUP BY event")
            for r in cursor.fetchall():
                print(f"    - {r['event']}: {r['c']}")

    except Exception as exc:
        print(f"  Error reading local analytics database: {exc}")
    finally:
        conn.close()

def inspect_backend_db():
    print_header("3. LOCAL APPLICATION DATABASE (data/smaran.db or backend/smaran.db)")
    candidates = [
        BASE_DIR / "data" / "smaran.db",
        BASE_DIR / "backend" / "smaran.db",
        BASE_DIR / "smaran.db",
    ]
    found = None
    for cand in candidates:
        if cand.exists():
            found = cand
            break

    if not found:
        print("  No local application database file found yet (generated automatically on first desktop app run).")
        return

    conn = sqlite3.connect(str(found))
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    try:
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
        tables = [row["name"] for row in cursor.fetchall()]
        print(f"  Database File: {found} ({found.stat().st_size:,} bytes)")
        print(f"  Tables: {', '.join(tables)}\n")

        for table in ["users", "chat_sessions", "audit_logs", "collections", "documents"]:
            if table in tables:
                cursor.execute(f"SELECT COUNT(*) as c FROM {table}")
                c = cursor.fetchone()["c"]
                print(f"  • {table:<16}: {c} rows")
    except Exception as exc:
        print(f"  Error reading backend database: {exc}")
    finally:
        conn.close()

def main():
    print("\n" + "#" * 70)
    print("  SMARAN.AI — DATABASE & USER DATA EXPLORER")
    print("#" * 70)
    print("  This script displays all data stored in SMARAN's databases.")
    
    inspect_cloud_database()
    inspect_local_analytics_db()
    inspect_backend_db()
    
    print("\n" + "=" * 70)
    print("  HOW TO VIEW IN BROWSER / GUI:")
    print("  1. Live Web Analytics: Open https://smaran-analytics.netlify.app/")
    print("     Enter Dashboard Key: OZoUnX6AYRoNs7TP8yY9LMKdsZon10US")
    print("  2. SQLite GUI Tool: Install 'DB Browser for SQLite' (https://sqlitebrowser.org/)")
    print("     and open: smaran-analytics/analytics.db or data/smaran.db")
    print("=" * 70 + "\n")

if __name__ == "__main__":
    main()
