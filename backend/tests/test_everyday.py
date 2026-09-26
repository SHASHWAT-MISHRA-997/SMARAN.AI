"""Reminders, clipboard history and the health check."""
from datetime import datetime, timedelta

from app import everyday as ev

NOW = datetime(2026, 9, 26, 15, 0, 0)   # a Saturday, 3 pm


def test_relative_times():
    assert ev.parse_when("remind me in 10 minutes to drink water", NOW) == NOW + timedelta(minutes=10)
    assert ev.parse_when("20 min baad yaad dilana chai", NOW) == NOW + timedelta(minutes=20)
    assert ev.parse_when("do ghante baad meeting yaad dilana", NOW) == NOW + timedelta(hours=2)
    assert ev.parse_when("in 30 seconds test", NOW) == NOW + timedelta(seconds=30)


def test_clock_times():
    assert ev.parse_when("remind me at 5 pm to call mom", NOW) == NOW.replace(hour=17)
    assert ev.parse_when("5:30 baje yaad dilana", NOW) == NOW.replace(hour=17, minute=30)
    assert ev.parse_when("remind me at 9 am to pay rent", NOW) == (NOW + timedelta(days=1)).replace(hour=9)
    assert ev.parse_when("kal subah 9 baje gym", NOW) == (NOW + timedelta(days=1)).replace(hour=9)
    assert ev.parse_when("raat 10 baje dawai", NOW) == NOW.replace(hour=22)


def test_a_count_is_not_a_time():
    assert ev.parse_when("remind me to call 2 people", NOW) is None


def test_what_to_remind():
    assert ev.reminder_text("remind me in 10 minutes to drink water") == "drink water"
    assert ev.reminder_text("remind me at 5 pm to call mom") == "call mom"
    assert ev.reminder_text("mujhe 20 min baad yaad dilana chai peena hai") == "chai peena hai"


def test_reminders_fire_once(tmp_path):
    r = ev.Reminders(str(tmp_path / "r.json"))
    a = r.add("water", NOW + timedelta(minutes=1))
    r.add("later", NOW + timedelta(hours=3))
    assert r.take_due(NOW) == []
    fired = r.take_due(NOW + timedelta(minutes=2))
    assert [f["id"] for f in fired] == [a["id"]]
    assert r.take_due(NOW + timedelta(minutes=3)) == []
    assert [p["text"] for p in r.pending()] == ["later"]
    assert r.cancel()["text"] == "later" and r.pending() == []


def test_secrets_stay_out_of_clipboard_history():
    h = ev.ClipboardHistory()
    for text in ["hello world", "sk-proj-abcdefghijklmnop1234", "Tr0ub4dor&3", "https://example.com/a?b=1",
                 "hello world", "C:\\Users\\me\\file.txt"]:
        h.note(text)
    assert [i["text"] for i in h.snapshot()] == ["C:\\Users\\me\\file.txt", "hello world", "https://example.com/a?b=1"]


def test_health_check_reports_readings():
    report = ev.health_check()
    assert 0 <= report["cpu_percent"] <= 100 and report["findings"]
    assert "CPU" in ev.health_message(report)


def test_sentences_reach_the_right_action():
    from app.desktop_agent import detect_desktop_intent as d
    assert d("remind me to open chrome at 5 pm")["action"] == "set_reminder"
    assert d("mujhe 10 minute baad yaad dilana paani peena")["action"] == "set_reminder"
    assert d("show my reminders")["action"] == "list_reminders"
    assert d("cancel the next reminder")["action"] == "cancel_reminder"
    assert d("clipboard history")["action"] == "clipboard_history"
    assert d("maine kya copy kiya")["action"] == "clipboard_history"
    assert d("clear clipboard history")["action"] == "clear_clipboard_history"
    assert d("why is my pc so slow")["action"] == "health_check"
    assert d("laptop slow kyu hai")["action"] == "health_check"


def test_the_actions_run(tmp_path, monkeypatch):
    import asyncio
    from app.desktop_agent import DesktopAgent
    monkeypatch.setattr(ev, "_reminders", ev.Reminders(str(tmp_path / "r.json")))
    out = asyncio.run(DesktopAgent.execute("set_reminder", {"text": "remind me in 10 minutes to stretch"}))
    assert out["success"] and "stretch" in out["message"]
    out = asyncio.run(DesktopAgent.execute("set_reminder", {"text": "remind me to stretch"}))
    assert not out["success"] and "When" in out["error"]
    listed = asyncio.run(DesktopAgent.execute("list_reminders", {}))
    assert "stretch" in listed["message"]
    health = asyncio.run(DesktopAgent.execute("health_check", {}))
    assert health["success"] and "CPU" in health["message"]


def test_refusals_are_not_commands():
    from app.desktop_agent import detect_desktop_intent as d
    assert (d("don't remind me about this") or {}).get("action") != "set_reminder"
