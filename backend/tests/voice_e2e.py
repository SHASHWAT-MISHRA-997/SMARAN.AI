"""Spoken commands, end to end: speech audio -> /api/voice/transcribe -> /api/desktop/voice-command.

Run by hand (python tests/voice_e2e.py). Nothing is changed on this computer:
actions that would open or draw are recorded instead of run, and the power
actions are sent unconfirmed, so they must stop at "say yes to confirm".
"""
import sys
import wave
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / ".cache" / "vosk"))
from probe import synth  # noqa: E402

from app import main as main_module  # noqa: E402
from app import paint_draw  # noqa: E402
from app.desktop_agent import DesktopAgent  # noqa: E402

ran = []
real_execute = DesktopAgent.execute


async def guarded_execute(action, params, confirmed=False):
    # Power actions go through the real gate (unconfirmed, they cannot run).
    if action in ("restart_computer", "shutdown_computer", "sleep_computer", "check_updates", "get_time"):
        return await real_execute(action, params, confirmed=False)
    ran.append((action, params))
    return {"success": True, "message": f"(test) would run {action}"}


DesktopAgent.execute = staticmethod(guarded_execute)
paint_draw.draw = lambda text: ran.append(("paint", text)) or {"success": True, "message": "(test) would draw"}

client = TestClient(main_module.app, client=("127.0.0.1", 50200))

COMMANDS = [
    ("Restart the computer", "restart_computer"),
    ("Check for updates", "check_updates"),
    ("What time is it", "get_time"),
    ("Open Notepad", "open_application"),
    ("Open Paint and draw a house", "paint"),
    ("Take a screenshot", "take_screenshot"),
]

ok = 0
for spoken, expected in COMMANDS:
    path = synth(spoken, "Microsoft Zira Desktop")
    with open(path, "rb") as audio:
        heard = client.post("/api/voice/transcribe", files={"file": ("a.wav", audio, "audio/wav")},
                            data={"language": "en"}).json()
    text = (heard.get("text") or heard.get("transcript") or "").strip()
    ran.clear()
    reply = client.post("/api/desktop/voice-command", json={"text": text, "language": "en"}).json()
    action = reply.get("action") or (ran[0][0] if ran else None)
    passed = action == expected or (expected == "paint" and ran and ran[0][0] == "paint")
    ok += bool(passed)
    gate = " [asked to confirm]" if reply.get("requires_confirmation") else ""
    print(f"{'PASS' if passed else 'FAIL'}  said {spoken!r:32} heard {text!r:34} -> {action}{gate} | {reply.get('message', '')[:70]}")
print(f"{ok}/{len(COMMANDS)} spoken commands reached the right action")
