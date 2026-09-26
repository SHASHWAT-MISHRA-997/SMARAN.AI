"""SMARAN takes the computer: looks at the screen, decides one step, does it,
looks again - until the goal is done, it needs you, or you press Stop.

The loop is the same one the coding agent uses, with the screen as the thing
being read and the mouse and keyboard as the tools:

    screenshot -> model (sees the screen with a coordinate grid) -> one action
    -> carried out through DesktopAgent -> screenshot again

Every action goes through DesktopAgent.execute, so "Computer use" off in
Settings stops it outright, and Stop (here, the shortcut or anywhere else)
lands before the next step. Starting a run is your go-ahead for its clicks
and typing, so those are not asked one by one; the steps that matter are
never in its hands at all: it has no power, delete or install actions, and a
step about money, a purchase, a password or an OTP is turned into a question
for you instead.

The model is whichever one can see: a local vision model through Ollama, or a
provider already set up in Settings (see screen_vision). Screenshots go to a
provider only when no local vision model is installed; the run says which.
"""

from __future__ import annotations

import base64
import io
import json
import logging
import os
import re
import shutil
import subprocess
import sys
import time
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger("computer_agent")

MAX_STEPS = 25
MODEL_WIDTH = 1280          # the screenshot the model sees is this wide
GRID = 100                  # a labelled line every GRID pixels of that image

Emit = Callable[[Dict[str, Any]], None]

PROMPT = """You are SMARAN, operating this computer for its owner. Goal:
{goal}

The screenshot is {w}x{h} pixels. Thin red lines are drawn every {grid} pixels
and numbered along the top and left edges - use them to read coordinates.
{history}
Decide the ONE next step. Reply with a single JSON object and nothing else:
  {{"thought": "what you see and why this step", "action": "click", "x": 640, "y": 360}}
Actions:
  click      x, y  (optional "button": "right" or "double")
  type       text  (types into whatever has focus - click the field first)
  key        key   (enter, tab, esc, backspace, up, down, left, right, pageup,
                    pagedown, home, end, f5, or a combination like ctrl+l, ctrl+t, alt+tab, win)
  scroll     direction ("up" or "down")
  open_app   name  (e.g. "notepad", "chrome", "spotify")
  open_url   url
  wait       seconds (1-5), when something is still loading
  ask        question - when you need the owner: a choice only they can make,
             a login, a payment, a purchase, sending anything to anyone
  done       summary - when the goal is achieved (say what you did and saw)
Never type passwords, card numbers or OTPs; never press Buy, Pay, Send money,
Place order or Checkout - use "ask" instead. Coordinates are in the screenshot's
pixels. If the last step did not work, try something different."""

# Things this loop will not do without the owner, whatever the model says.
_NEEDS_OWNER = re.compile(
    r"\b(pay|payment|buy|purchase|checkout|check out|place order|add to cart|send money|transfer|upi|"
    r"gpay|paytm|phonepe|net ?banking|credit card|debit card|cvv|otp|password|passcode|pin\b|"
    r"shut ?down|restart|reboot|format|delete all|factory reset|uninstall)\b", re.I)


# ---------------------------------------------------------------------------
# Screen
# ---------------------------------------------------------------------------

def capture() -> Optional[bytes]:
    """PNG bytes of the whole primary screen, or None."""
    from app.desktop_agent import DesktopAgent
    shot = DesktopAgent._action_take_screenshot({})
    data = shot.get("screenshot_base64") if isinstance(shot, dict) else None
    return base64.b64decode(data) if data else None


def screen_size() -> tuple:
    try:
        import mss
        with mss.mss() as sct:
            mon = sct.monitors[1]
            return mon["width"], mon["height"]
    except Exception:  # noqa: BLE001
        pass
    try:
        from PIL import ImageGrab
        return ImageGrab.grab().size
    except Exception:  # noqa: BLE001
        return (0, 0)


def prepare(png: bytes) -> tuple:
    """(image for the model as base64 PNG, scale back to the screen, preview JPEG b64)."""
    from PIL import Image, ImageDraw

    img = Image.open(io.BytesIO(png)).convert("RGB")
    scale = img.width / MODEL_WIDTH if img.width > MODEL_WIDTH else 1.0
    if scale != 1.0:
        img = img.resize((MODEL_WIDTH, round(img.height / scale)))
    preview = img.copy()
    draw = ImageDraw.Draw(img)
    for x in range(GRID, img.width, GRID):
        draw.line([(x, 0), (x, img.height)], fill=(255, 40, 40), width=1)
        draw.text((x + 2, 2), str(x), fill=(255, 40, 40))
    for y in range(GRID, img.height, GRID):
        draw.line([(0, y), (img.width, y)], fill=(255, 40, 40), width=1)
        draw.text((2, y + 2), str(y), fill=(255, 40, 40))
    out = io.BytesIO()
    img.save(out, format="PNG")
    small = io.BytesIO()
    preview.thumbnail((720, 720))
    preview.save(small, format="JPEG", quality=70)
    return (base64.b64encode(out.getvalue()).decode(), scale, img.size,
            base64.b64encode(small.getvalue()).decode())


# ---------------------------------------------------------------------------
# Keys: combinations on Windows and Linux
# ---------------------------------------------------------------------------

_XDO = {"enter": "Return", "return": "Return", "esc": "Escape", "escape": "Escape", "tab": "Tab",
        "backspace": "BackSpace", "delete": "Delete", "space": "space", "up": "Up", "down": "Down",
        "left": "Left", "right": "Right", "pageup": "Prior", "pagedown": "Next", "home": "Home",
        "end": "End", "ctrl": "ctrl", "control": "ctrl", "alt": "alt", "shift": "shift",
        "win": "super", "windows": "super", "super": "super", "cmd": "super"}
_VK = {"enter": 0x0D, "return": 0x0D, "esc": 0x1B, "escape": 0x1B, "tab": 0x09, "backspace": 0x08,
       "delete": 0x2E, "space": 0x20, "up": 0x26, "down": 0x28, "left": 0x25, "right": 0x27,
       "pageup": 0x21, "pagedown": 0x22, "home": 0x24, "end": 0x23, "ctrl": 0x11, "control": 0x11,
       "alt": 0x12, "shift": 0x10, "win": 0x5B, "windows": 0x5B}


def press(combo: str) -> Dict[str, Any]:
    parts = [p.strip().lower() for p in re.split(r"\s*\+\s*", combo or "") if p.strip()]
    if not parts:
        return {"success": False, "error": "No key given."}
    if sys.platform == "win32":
        import ctypes
        codes = []
        for p in parts:
            if p in _VK:
                codes.append(_VK[p])
            elif re.fullmatch(r"f([1-9]|1[0-2])", p):
                codes.append(0x6F + int(p[1:]))
            elif len(p) == 1 and p.isalnum():
                codes.append(ord(p.upper()))
            else:
                return {"success": False, "error": f"Unknown key: {p}"}
        user32 = ctypes.windll.user32
        for c in codes:
            user32.keybd_event(c, 0, 0, 0)
            time.sleep(0.02)
        for c in reversed(codes):
            user32.keybd_event(c, 0, 0x0002, 0)
        return {"success": True, "message": f"Pressed {combo}."}
    if sys.platform.startswith("linux"):
        tool = shutil.which("xdotool")
        if not tool or not os.environ.get("DISPLAY"):
            return {"success": False, "error": "Keys need an X11 desktop with xdotool installed."}
        name = "+".join(_XDO.get(p, p.upper() if re.fullmatch(r"f\d{1,2}", p) else p) for p in parts)
        res = subprocess.run([tool, "key", "--clearmodifiers", name], capture_output=True, timeout=5)
        return {"success": res.returncode == 0, "message": f"Pressed {combo}."}
    return {"success": False, "error": f"Key presses are not supported on {sys.platform} yet."}


# ---------------------------------------------------------------------------
# One step
# ---------------------------------------------------------------------------

def parse(reply: str) -> Optional[Dict[str, Any]]:
    """The JSON action in a model's reply, however it was wrapped."""
    if not reply:
        return None
    text = re.sub(r"```(?:json)?", "", reply)
    start = text.find("{")
    while start >= 0:
        depth = 0
        for i in range(start, len(text)):
            if text[i] == "{":
                depth += 1
            elif text[i] == "}":
                depth -= 1
                if depth == 0:
                    try:
                        data = json.loads(text[start:i + 1])
                    except ValueError:
                        break
                    if isinstance(data, dict) and data.get("action"):
                        return data
                    break
        start = text.find("{", start + 1)
    return None


def needs_owner(step: Dict[str, Any]) -> Optional[str]:
    """Why this step is the owner's to take, or None."""
    words = " ".join(str(step.get(k, "")) for k in ("thought", "text", "url", "name", "key"))
    if step.get("action") in ("type", "click", "open_url", "open_app", "key") and _NEEDS_OWNER.search(words):
        return "It involves money, a purchase, a password or the power of the PC."
    if step.get("action") == "type":
        from app.everyday import looks_secret
        if looks_secret(str(step.get("text", ""))):
            return "That looks like a password or key."
    return None


async def act(step: Dict[str, Any], scale: float, token: str = "") -> Dict[str, Any]:
    """Carry out one step. Every desktop action carries the run's control
    session, so Stop - here, the shortcut or the tray - lands before the next."""
    from app.desktop_agent import DesktopAgent

    async def execute(action: str, params: Dict[str, Any]) -> Dict[str, Any]:
        return await DesktopAgent.execute(action, {**params, "control_session": token}, confirmed=True)

    kind = step.get("action")
    if kind == "click":
        try:
            x = round(float(step["x"]) * scale)
            y = round(float(step["y"]) * scale)
        except (KeyError, TypeError, ValueError):
            return {"success": False, "error": "A click needs x and y."}
        button = str(step.get("button", "left")).lower()
        return await execute("mouse_click", {"x": x, "y": y, "button": button})
    if kind == "type":
        return await execute("type_text", {"text": str(step.get("text", ""))})
    if kind == "key":
        from app import control_prefs, control_session
        if not control_prefs.load()["computer_use_enabled"]:
            return {"success": False, "blocked": True, "error": "Computer use is switched off in Settings."}
        if not control_session.is_running(token):
            return {"success": False, "stopped": True, "error": "Control was stopped."}
        return press(str(step.get("key", "")))
    if kind == "scroll":
        delta = 360 if str(step.get("direction", "down")).lower() == "up" else -360
        return await execute("mouse_scroll", {"delta": delta})
    if kind == "open_app":
        return await execute("open_application", {"name": str(step.get("name", ""))})
    if kind == "open_url":
        return await execute("open_url", {"url": str(step.get("url", ""))})
    if kind == "wait":
        try:
            seconds = max(1.0, min(5.0, float(step.get("seconds", 2))))
        except (TypeError, ValueError):
            seconds = 2.0
        time.sleep(seconds)
        return {"success": True, "message": f"Waited {seconds:.0f}s."}
    return {"success": False, "error": f"Unknown action: {kind}"}


def describe(step: Dict[str, Any]) -> str:
    kind = step.get("action")
    return {
        "click": lambda: f"Click at ({step.get('x')}, {step.get('y')})" + (f" [{step.get('button')}]" if step.get("button") not in (None, "left") else ""),
        "type": lambda: f"Type \"{str(step.get('text', ''))[:60]}\"",
        "key": lambda: f"Press {step.get('key')}",
        "scroll": lambda: f"Scroll {step.get('direction', 'down')}",
        "open_app": lambda: f"Open {step.get('name')}",
        "open_url": lambda: f"Open {step.get('url')}",
        "wait": lambda: f"Wait {step.get('seconds', 2)}s",
        "ask": lambda: "Ask you",
        "done": lambda: "Done",
    }.get(kind, lambda: str(kind))()


# ---------------------------------------------------------------------------
# The loop
# ---------------------------------------------------------------------------

def _see(question: str, image_b64: str) -> Dict[str, Any]:
    from app import screen_vision
    return screen_vision.ask(question, image_b64)


async def run(goal: str, emit: Emit, token: str,
              see: Callable[[str, str], Dict[str, Any]] = _see,
              max_steps: int = MAX_STEPS) -> None:
    """Work towards `goal` under control session `token`, emitting status,
    step, question, done, stopped and error events."""
    import asyncio
    from app import control_session

    def stopped() -> bool:
        return not control_session.is_running(token)

    history: List[str] = []
    failures = 0
    for n in range(1, max_steps + 1):
        if stopped():
            emit({"type": "stopped"})
            return
        png = await asyncio.to_thread(capture)
        if not png:
            emit({"type": "error", "message": "Could not take a screenshot. On Linux this needs an X11 "
                                              "desktop (Wayland blocks screen capture by other apps)."})
            return
        image, scale, size, preview = await asyncio.to_thread(prepare, png)
        recent = "\n".join(history[-8:])
        prompt = PROMPT.format(goal=goal, w=size[0], h=size[1], grid=GRID,
                               history=("\nSteps so far:\n" + recent + "\n") if recent else "")
        emit({"type": "status", "message": f"Step {n}: looking at the screen…"})
        seen = await asyncio.to_thread(see, prompt, image)
        if seen.get("error"):
            emit({"type": "error", "message": seen["error"]})
            return
        step = parse(seen.get("answer", ""))
        if step is None:
            failures += 1
            history.append(f"{n}. (reply was not a JSON action - reply with JSON only)")
            if failures >= 3:
                emit({"type": "error", "message": "The model kept answering without an action. "
                                                  "Try a stronger vision model."})
                return
            continue
        base = {"type": "step", "n": n, "thought": str(step.get("thought", ""))[:400],
                "action": step.get("action"), "label": describe(step), "screenshot": preview,
                "model": seen.get("model"), "where": seen.get("where")}
        if step.get("action") == "done":
            emit({**base, "result": "Goal reached."})
            emit({"type": "done", "summary": str(step.get("summary") or step.get("thought") or "Done."), "steps": n})
            return
        if step.get("action") == "ask":
            emit({**base, "result": "Waiting for you."})
            emit({"type": "question", "question": str(step.get("question") or step.get("thought") or "What next?")})
            return
        why = needs_owner(step)
        if why:
            emit({**base, "result": "Not done without you."})
            emit({"type": "question", "question": f"Next I would: {describe(step)}. {why} "
                                                  "Do it yourself, or tell me how to continue."})
            return
        if stopped():
            emit({"type": "stopped"})
            return
        result = await act(step, scale, token)
        control_session.note_step(token)
        ok = bool(result.get("success"))
        said = result.get("message") or result.get("error") or ("Done." if ok else "Failed.")
        emit({**base, "ok": ok, "result": said})
        history.append(f"{n}. {describe(step)} -> {'ok' if ok else 'FAILED: ' + str(said)[:120]}")
        if result.get("stopped"):
            emit({"type": "stopped"})
            return
        if result.get("blocked"):
            emit({"type": "error", "message": said})
            return
        await asyncio.sleep(0.8)   # let the screen catch up before looking again
    emit({"type": "error", "message": f"Stopped after {max_steps} steps without finishing. "
                                      "What was done so far stays done; ask again to carry on."})
