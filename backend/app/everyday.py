"""Everyday helpers the assistant does itself: reminders, the clipboard and
its history, and a health check that says why the PC is slow.

Ideas taken from what Brahma AI offers as actions (reminder, clipboard
manager, system health); written here from scratch for SMARAN.

Reminders are kept in DATA_DIR/reminders.json so they survive a restart;
the page asks /api/reminders/fired and shows, speaks and notifies each one.

Clipboard history is kept in memory only - never written to disk - and
skips anything that looks like a password, key or token.
"""

from __future__ import annotations

import json
import logging
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

logger = logging.getLogger("everyday")

WIN_NO_WINDOW = 0x08000000 if sys.platform == "win32" else 0


# ---------------------------------------------------------------------------
# Clipboard, on every desktop
# ---------------------------------------------------------------------------

def _linux_clipboard_tools():
    """(read command, write command) for this session, or (None, None)."""
    if os.getenv("WAYLAND_DISPLAY") and shutil.which("wl-paste") and shutil.which("wl-copy"):
        return ["wl-paste", "--no-newline"], ["wl-copy"]
    if shutil.which("xclip"):
        return ["xclip", "-selection", "clipboard", "-o"], ["xclip", "-selection", "clipboard"]
    if shutil.which("xsel"):
        return ["xsel", "--clipboard", "--output"], ["xsel", "--clipboard", "--input"]
    return None, None


LINUX_HINT = ("Clipboard access on Linux needs wl-clipboard (Wayland) or xclip / xsel (X11). "
              "Install one, for example: sudo apt install wl-clipboard xclip")


def read_clipboard() -> str:
    """The clipboard's text. Raises RuntimeError with a fix when it cannot."""
    if sys.platform == "win32":
        result = subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-Clipboard -Raw"],
            capture_output=True, text=True, encoding="utf-8", timeout=5, creationflags=WIN_NO_WINDOW)
        return (result.stdout or "").rstrip("\r\n")
    if sys.platform == "darwin":
        return subprocess.run(["pbpaste"], capture_output=True, text=True, timeout=5).stdout
    read, _ = _linux_clipboard_tools()
    if not read:
        raise RuntimeError(LINUX_HINT)
    result = subprocess.run(read, capture_output=True, text=True, timeout=5)
    # An empty clipboard is an error exit for xclip; it is still just empty.
    return result.stdout if result.returncode == 0 else ""


def write_clipboard(text: str) -> None:
    if sys.platform == "win32":
        subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             "[Console]::InputEncoding = [System.Text.Encoding]::UTF8; Set-Clipboard -Value ([Console]::In.ReadToEnd())"],
            input=text, encoding="utf-8", check=True, capture_output=True, timeout=5,
            creationflags=WIN_NO_WINDOW)
        return
    if sys.platform == "darwin":
        subprocess.run(["pbcopy"], input=text, text=True, check=True, timeout=5)
        return
    _, write = _linux_clipboard_tools()
    if not write:
        raise RuntimeError(LINUX_HINT)
    # wl-copy and xclip stay running to serve the selection; don't wait on them.
    proc = subprocess.Popen(write, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL, text=True)
    proc.stdin.write(text)
    proc.stdin.close()


_SECRET_SHAPES = [
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    re.compile(r"\b(sk-|sk-ant-|ghp_|github_pat_|hf_|gsk_|AIza|xox[abprs]-|AKIA|rzp_)[A-Za-z0-9_-]{8,}"),
    re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\."),
]


def looks_secret(text: str) -> bool:
    """A password, key or token - kept out of the history."""
    t = (text or "").strip()
    if any(p.search(t) for p in _SECRET_SHAPES):
        return True
    # One unbroken token mixing letters, digits and symbols: the shape of a
    # password copied from a manager. Ordinary words, URLs and paths pass.
    if 8 <= len(t) <= 128 and not re.search(r"\s", t) and not re.match(r"^(https?://|[A-Za-z]:\\|/|~)", t):
        classes = sum(bool(re.search(p, t)) for p in (r"[a-z]", r"[A-Z]", r"\d", r"[^A-Za-z0-9]"))
        if classes >= 3:
            return True
    return False


class ClipboardHistory:
    """The last few things copied, in memory. Started on first use."""

    LIMIT = 25

    def __init__(self) -> None:
        self.items: List[Dict[str, Any]] = []
        self._lock = threading.Lock()
        self._thread: Optional[threading.Thread] = None
        self._last = None
        self.error = ""

    def note(self, text: str) -> None:
        text = (text or "").strip()
        if not text or text == self._last:
            return
        self._last = text
        if looks_secret(text):
            return
        with self._lock:
            self.items = [i for i in self.items if i["text"] != text]
            self.items.insert(0, {"text": text[:5000], "at": datetime.now().strftime("%H:%M")})
            del self.items[self.LIMIT:]

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._thread = threading.Thread(target=self._watch, name="clipboard-history", daemon=True)
        self._thread.start()

    def _watch(self) -> None:
        # On Windows, read only when the clipboard has actually changed:
        # starting PowerShell every second and a half would cost real CPU.
        sequence = None
        if sys.platform == "win32":
            try:
                import ctypes
                sequence = ctypes.windll.user32.GetClipboardSequenceNumber
            except (ImportError, AttributeError, OSError):
                sequence = None
        seen = None
        while True:
            try:
                if sequence is not None:
                    current = sequence()
                    if current == seen:
                        time.sleep(1.0)
                        continue
                    seen = current
                self.note(read_clipboard())
                self.error = ""
            except Exception as exc:  # noqa: BLE001 - said when asked, not raised
                self.error = str(exc)[:300]
                time.sleep(30)
            time.sleep(1.0 if sequence is not None else 2.0)

    def snapshot(self) -> List[Dict[str, Any]]:
        with self._lock:
            return list(self.items)

    def clear(self) -> None:
        with self._lock:
            self.items = []


clipboard_history = ClipboardHistory()


# ---------------------------------------------------------------------------
# Reminders
# ---------------------------------------------------------------------------

_NUM = {"ek": 1, "one": 1, "a": 1, "an": 1, "do": 2, "two": 2, "teen": 3, "three": 3, "char": 4, "chaar": 4,
        "four": 4, "paanch": 5, "panch": 5, "five": 5, "das": 10, "ten": 10, "pandrah": 15, "fifteen": 15,
        "bees": 20, "twenty": 20, "tees": 30, "thirty": 30, "aadha": 0.5, "half": 0.5}
_UNIT = {"s": 1, "sec": 1, "secs": 1, "second": 1, "seconds": 1, "second(s)": 1, "sekand": 1,
         "m": 60, "min": 60, "mins": 60, "minute": 60, "minutes": 60, "minat": 60, "mint": 60,
         "h": 3600, "hr": 3600, "hrs": 3600, "hour": 3600, "hours": 3600, "ghanta": 3600, "ghante": 3600,
         "day": 86400, "days": 86400, "din": 86400}

_UNITS_LONG = r"seconds?|secs?|sekand|minutes?|mins?|minat|mint|hours?|hrs?|ghant[ae]|days?|din"
# Digits take any unit ("10m", "2 h"); a spoken number needs a whole unit word
# and a space before it, so "9 am" is not read as "a minute".
_RELATIVE = re.compile(
    r"\b(?:in|after)?\s*(?:(\d+(?:\.\d+)?)\s*(" + _UNITS_LONG + r"|[smh])"
    r"|(" + "|".join(_NUM) + r")\s+(" + _UNITS_LONG + r"))\b"
    r"\s*(?:mein|me|main|baad|bad|later|from now)?", re.I)
_CLOCK = re.compile(
    r"\b(?:at\s+)?(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|baje|bje)?\b", re.I)


def parse_when(text: str, now: Optional[datetime] = None) -> Optional[datetime]:
    """When a spoken reminder is due: "in 10 minutes", "20 min baad", "at 5 pm",
    "5:30 baje", "kal subah 9 baje". None when no time is given."""
    now = now or datetime.now()
    rel = _RELATIVE.search(text)
    if rel:
        amount = (rel.group(1) or rel.group(3)).lower()
        word = (rel.group(2) or rel.group(4)).lower()
        n = float(amount) if rel.group(1) else float(_NUM[amount])
        unit = _UNIT.get(word, _UNIT.get(word.rstrip("s"), 60))
        return now + timedelta(seconds=n * unit)
    # A clock time needs a marker - "at", am/pm or baje - so "remind me to
    # call 2 people" is not read as two o'clock.
    for m in _CLOCK.finditer(text):
        at_word = text[max(0, m.start() - 3):m.start()].lower().strip() == "at" or m.group(0).lower().startswith("at")
        if not (m.group(3) or at_word):
            continue
        hour, minute = int(m.group(1)), int(m.group(2) or 0)
        if hour > 23 or minute > 59:
            continue
        mark = (m.group(3) or "").lower()
        lower = text.lower()
        if mark == "pm" and hour < 12:
            hour += 12
        elif mark == "am" and hour == 12:
            hour = 0
        elif mark in ("baje", "bje", "") and hour < 12:
            if re.search(r"\b(shaam|sham|raat|evening|night|dopahar|afternoon)\b", lower) and hour != 12:
                hour += 12
        due = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if re.search(r"\b(kal|tomorrow)\b", lower):
            due += timedelta(days=1)
        elif due <= now:
            # A time already past today means the next one: 7 pm said at
            # 9 pm is tomorrow; 5 (no am/pm) said at 3 pm is 5 pm.
            ambiguous = mark not in ("am", "pm") and not re.search(
                r"\b(subah|morning|shaam|sham|raat|evening|night|dopahar|afternoon)\b", lower)
            due += timedelta(hours=12) if ambiguous and hour < 12 and due + timedelta(hours=12) > now else timedelta(days=1)
        return due
    return None


_FILLER = re.compile(
    r"^(?:hey\s+\w+[,\s]+)?(?:please\s+)?(?:remind\s+me|reminder\s+(?:set|lagao|laga\s*do|do)|"
    r"mujhe\s+yaad\s+dila(?:na|o|dena|\s*dena)?|yaad\s+dila(?:na|o|dena|\s*dena)?|set\s+(?:a\s+)?reminder)\s*"
    r"(?:to|ki|that|for|ke\s+liye)?\s*", re.I)


def reminder_text(text: str) -> str:
    """What to be reminded of, without the command and the time."""
    t = _FILLER.sub("", text.strip())
    # The command can come after the time too: "mujhe 20 min baad yaad dilana ...".
    t = re.sub(r"\b(?:mujhe\s+)?yaad\s+dila(?:na|o|dena|\s*dena)?\b|\bremind\s+me\b|^\s*mujhe\b", " ", t, flags=re.I)
    t = _RELATIVE.sub(" ", t)
    t = re.sub(r"\b(?:at\s+)?\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm|baje|bje)\b", " ", t, flags=re.I)
    t = re.sub(r"\b(?:kal|tomorrow|subah|shaam|sham|raat|morning|evening|tonight|today|aaj)\b", " ", t, flags=re.I)
    t = re.sub(r"\b(?:remind\s+me|mujhe|yaad\s+dila\w*|reminder|ki|ke\s+liye|to|that|please)\b\s*$", "", t.strip(), flags=re.I)
    t = re.sub(r"^\s*(?:to|ki|that|ke\s+liye)\b", "", t.strip(), flags=re.I)
    t = re.sub(r"\s{2,}", " ", t).strip(" ,.-")
    return t or "Reminder"


class Reminders:
    def __init__(self, path: Optional[str] = None) -> None:
        if path is None:
            from app.config import settings
            path = os.path.join(settings.DATA_DIR, "reminders.json")
        self.path = path
        self._lock = threading.Lock()

    def _load(self) -> List[Dict[str, Any]]:
        try:
            with open(self.path, encoding="utf-8") as fh:
                data = json.load(fh)
            return data if isinstance(data, list) else []
        except (OSError, ValueError):
            return []

    def _save(self, items: List[Dict[str, Any]]) -> None:
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(items, fh, ensure_ascii=False, indent=1)
        os.replace(tmp, self.path)

    def add(self, text: str, due: datetime) -> Dict[str, Any]:
        item = {"id": uuid.uuid4().hex[:10], "text": text[:300], "due": due.isoformat(timespec="seconds"),
                "fired": False}
        with self._lock:
            items = self._load()
            items.append(item)
            self._save(items[-200:])
        return item

    def pending(self) -> List[Dict[str, Any]]:
        return sorted((i for i in self._load() if not i.get("fired")), key=lambda i: i["due"])

    def cancel(self, ident: str = "") -> Optional[Dict[str, Any]]:
        """Cancel one by id, or the next one due when no id is given."""
        with self._lock:
            items = self._load()
            waiting = sorted((i for i in items if not i.get("fired")), key=lambda i: i["due"])
            target = next((i for i in waiting if i["id"] == ident), None) if ident else (waiting[0] if waiting else None)
            if target:
                items = [i for i in items if i["id"] != target["id"]]
                self._save(items)
            return target

    def take_due(self, now: Optional[datetime] = None) -> List[Dict[str, Any]]:
        """Reminders that have come due, marked as fired so each fires once."""
        now = now or datetime.now()
        with self._lock:
            items = self._load()
            due = [i for i in items if not i.get("fired") and datetime.fromisoformat(i["due"]) <= now]
            if due:
                for i in due:
                    i["fired"] = True
                # Fired ones are kept a day, for "what did you remind me of".
                cutoff = now - timedelta(days=1)
                items = [i for i in items if not i.get("fired") or datetime.fromisoformat(i["due"]) > cutoff]
                self._save(items)
            return due


_reminders: Optional[Reminders] = None


def reminders() -> Reminders:
    global _reminders
    if _reminders is None:
        _reminders = Reminders()
    return _reminders


def describe_due(due: datetime, now: Optional[datetime] = None) -> str:
    now = now or datetime.now()
    seconds = (due - now).total_seconds()
    if seconds < 90:
        secs = max(1, round(seconds))
        return f"in {secs} second{'s' if secs != 1 else ''}"
    if seconds < 3600:
        mins = max(1, round(seconds / 60))
        return f"in {mins} minute{'s' if mins != 1 else ''}"
    day = "today" if due.date() == now.date() else ("tomorrow" if due.date() == (now + timedelta(days=1)).date()
                                                    else due.strftime("%d %b"))
    return f"{day} at {due.strftime('%I:%M %p').lstrip('0')}"


# ---------------------------------------------------------------------------
# Health check: why is the PC slow
# ---------------------------------------------------------------------------

def health_check() -> Dict[str, Any]:
    """Readings and plain reasons, from psutil. Nothing is changed."""
    import psutil

    # Prime per-process CPU counters, then measure over a short window.
    procs = list(psutil.process_iter(["pid", "name", "memory_info"]))
    for p in procs:
        try:
            p.cpu_percent(None)
        except (psutil.Error, OSError):
            pass
    cpu = psutil.cpu_percent(interval=1.0)
    cores = psutil.cpu_count() or 1
    rows = []
    for p in procs:
        try:
            rows.append({"name": p.info["name"] or "?", "pid": p.info["pid"],
                         "cpu": round(p.cpu_percent(None) / cores, 1),
                         "mem_mb": round((p.info["memory_info"].rss if p.info["memory_info"] else 0) / 2**20)})
        except (psutil.Error, OSError):
            continue
    mem = psutil.virtual_memory()
    root = os.environ.get("SystemDrive", "C:") + "\\" if sys.platform == "win32" else "/"
    disk = psutil.disk_usage(root)
    findings: List[str] = []
    top_cpu = sorted(rows, key=lambda r: r["cpu"], reverse=True)[:5]
    top_mem = sorted(rows, key=lambda r: r["mem_mb"], reverse=True)[:5]
    if cpu >= 85:
        findings.append(f"The processor is nearly flat out ({cpu:.0f}%); {top_cpu[0]['name']} is using the most.")
    if mem.percent >= 85:
        findings.append(f"Memory is {mem.percent:.0f}% full; {top_mem[0]['name']} holds {top_mem[0]['mem_mb']} MB. "
                        "Closing it or some browser tabs will help.")
    if disk.percent >= 90:
        findings.append(f"The system drive is {disk.percent:.0f}% full ({disk.free // 2**30} GB free). "
                        "Windows and apps slow down when it is this full.")
    swap = psutil.swap_memory()
    if swap.total and swap.percent >= 60 and mem.percent >= 75:
        findings.append("The PC is paging to disk heavily - it has run out of memory for what is open.")
    uptime_days = (time.time() - psutil.boot_time()) / 86400
    if uptime_days >= 7:
        findings.append(f"It has been running {uptime_days:.0f} days without a restart; a restart often helps.")
    battery = None
    try:
        b = psutil.sensors_battery()
        if b is not None:
            battery = {"percent": round(b.percent), "plugged": bool(b.power_plugged)}
            if not b.power_plugged and b.percent < 25:
                findings.append("The battery is low and unplugged; power saving can slow the processor down.")
    except (AttributeError, NotImplementedError, OSError):
        pass
    if not findings:
        findings.append("Nothing looks wrong right now: processor, memory and disk all have room.")
    return {
        "cpu_percent": cpu, "memory_percent": mem.percent,
        "memory_used_gb": round(mem.used / 2**30, 1), "memory_total_gb": round(mem.total / 2**30, 1),
        "disk_percent": disk.percent, "disk_free_gb": disk.free // 2**30,
        "uptime_days": round(uptime_days, 1), "battery": battery,
        "top_cpu": top_cpu, "top_memory": top_mem, "findings": findings,
    }


def health_message(report: Dict[str, Any]) -> str:
    lines = [f"CPU {report['cpu_percent']:.0f}% · RAM {report['memory_used_gb']}/{report['memory_total_gb']} GB "
             f"({report['memory_percent']:.0f}%) · Disk {report['disk_percent']:.0f}% used, "
             f"{report['disk_free_gb']} GB free"]
    lines += [f"- {f}" for f in report["findings"]]
    lines.append("Using the most memory: " + ", ".join(
        f"{r['name']} ({r['mem_mb']} MB)" for r in report["top_memory"][:3]))
    return "\n".join(lines)
