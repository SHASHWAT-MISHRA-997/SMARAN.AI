"""Live browsing: a real browser window on this computer, driven step by step.

You give it a task - "find the opening hours of the nearest Apollo pharmacy",
"compare the price of this phone on two sites" - and it opens a browser you
can watch, reads the page, clicks and types, and reports back with what it
found and every step it took.

HOW
    Chrome, Edge and Brave speak the Chrome DevTools Protocol when started with
    --remote-debugging-port. That is what Playwright and Puppeteer use
    underneath, so no driver and no 150 MB browser download are needed: the
    browser already on the machine is started in a window of its own. The VS
    Code extension drives its browser the same way (src/agent/browser.ts).

    Each step the model is shown the page as text - title, address, a list of
    the things that can be pressed or typed into, each with a number, and the
    readable text - and answers with one action as JSON. The action is carried
    out, a screenshot is taken, and the next step begins.

WHAT IT WILL NOT DO
    - Use the person's own browser profile. The window starts from an empty,
      throwaway profile that is deleted afterwards: no tabs, cookies, saved
      passwords or logins are in reach of the model.
    - Open anything but http(s), or any address on this machine or the local
      network. A page could otherwise steer it into the router's admin page,
      or into SMARAN.AI's own server.
    - Type into a password or card field. Signing in and paying are for the
      person, in the window, themselves.
    - Press something irreversible - pay, buy, place order, send, delete,
      submit, confirm... It stops there and says so; the person can press it
      in the window if that is what they want.
"""

from __future__ import annotations

import ipaddress
import json
import logging
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
import urllib.request
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger("live_browser")

MAX_STEPS = 15
STEP_TIMEOUT = 20.0

# ---------------------------------------------------------------------------
# Finding a browser
# ---------------------------------------------------------------------------

_WINDOWS = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe",
]
_MAC = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
]
# On Linux the names differ by distribution and packaging; `which` settles it.
_LINUX = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser",
          "microsoft-edge", "microsoft-edge-stable", "brave-browser", "brave",
          "vivaldi-stable", "vivaldi", "opera"]
# Installed but not on PATH: snap when /snap/bin is missing from a desktop
# session's PATH, and vendor packages that live under /opt.
_LINUX_PATHS = ["/snap/bin/chromium", "/usr/lib/chromium/chromium", "/usr/lib/chromium-browser/chromium-browser",
                "/opt/google/chrome/chrome", "/opt/microsoft/msedge/msedge",
                "/opt/brave.com/brave/brave", "/opt/vivaldi/vivaldi"]


def _playwright_chromium() -> Optional[str]:
    """A Chromium that Playwright downloaded, if there is one - any platform."""
    roots = [os.getenv("PLAYWRIGHT_BROWSERS_PATH", "")]
    home = os.path.expanduser("~")
    roots += [os.path.join(home, ".cache", "ms-playwright"),
              os.path.join(os.getenv("LOCALAPPDATA", ""), "ms-playwright") if os.getenv("LOCALAPPDATA") else "",
              os.path.join(home, "Library", "Caches", "ms-playwright")]
    inner = {"win32": [r"chrome-win\chrome.exe", r"chrome-win64\chrome.exe"],
             "darwin": ["chrome-mac/Chromium.app/Contents/MacOS/Chromium"]}.get(
                 sys.platform, ["chrome-linux/chrome", "chrome-linux64/chrome"])
    for root in filter(None, roots):
        if not os.path.isdir(root):
            continue
        for entry in sorted(os.listdir(root), reverse=True):
            if not entry.startswith("chromium-"):
                continue
            for rel in inner:
                path = os.path.join(root, entry, rel)
                if os.path.isfile(path):
                    return path
    return None


def find_browser() -> Optional[str]:
    """A Chromium-family browser on this machine, or None."""
    override = os.getenv("SMARAN_BROWSER", "").strip()
    if override and os.path.isfile(override):
        return override
    if sys.platform == "win32":
        local = os.getenv("LOCALAPPDATA", "")
        # Per-user installs - the default for Chrome and Brave without admin.
        extra = [os.path.join(local, r"Google\Chrome\Application\chrome.exe"),
                 os.path.join(local, r"BraveSoftware\Brave-Browser\Application\brave.exe")] if local else []
        for path in extra + _WINDOWS:
            if os.path.isfile(path):
                return path
        return _playwright_chromium()
    if sys.platform == "darwin":
        return next((p for p in _MAC if os.path.isfile(p)), None) or _playwright_chromium()
    for name in _LINUX:
        found = shutil.which(name)
        if found:
            return found
    return next((p for p in _LINUX_PATHS if os.path.isfile(p)), None) or _playwright_chromium()


# ---------------------------------------------------------------------------
# What may be opened
# ---------------------------------------------------------------------------

class Refused(Exception):
    """An action the browser will not take, with the reason to show."""


def check_url(url: str) -> str:
    """The URL to open, or Refused. Adds https:// to a bare domain."""
    url = (url or "").strip()
    if not url:
        raise Refused("No address was given.")
    if not re.match(r"^[a-z][a-z0-9+.-]*:", url, re.I):
        url = "https://" + url
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise Refused("Only web pages (http and https) can be opened, not %s: addresses."
                      % parsed.scheme)
    host = (parsed.hostname or "").strip("[]").lower()
    if not host:
        raise Refused("That address has no host.")
    if host in ("localhost",) or host.endswith(".local") or host.endswith(".localhost"):
        raise Refused("Addresses on this computer or the local network are not opened.")
    try:
        addresses = {info[4][0] for info in socket.getaddrinfo(host, None)}
    except socket.gaierror:
        # Let the browser show its own "site not found"; there is nothing
        # local to protect when the name does not resolve.
        return url
    for address in addresses:
        ip = ipaddress.ip_address(address.split("%")[0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved \
                or ip.is_multicast or ip.is_unspecified:
            raise Refused("Addresses on this computer or the local network are not opened.")
    return url


# Words on a control that mean "this cannot be taken back".
_IRREVERSIBLE = re.compile(
    r"\b(pay|payment|buy|purchase|checkout|check out|place (your )?order|order now|"
    r"confirm|send|submit|delete|remove|unsubscribe|subscribe|transfer|donate|"
    r"book now|reserve|sign up|register|post|publish|apply now)\b", re.I)


# ---------------------------------------------------------------------------
# The browser
# ---------------------------------------------------------------------------

_SNAPSHOT_JS = r"""
(() => {
  const out = [];
  let n = 0;
  const seen = new Set();
  const pick = 'a[href], button, input:not([type=hidden]), textarea, select, '
    + '[role=button], [role=link], [role=tab], [role=menuitem], [role=checkbox], '
    + '[role=textbox], [role=combobox], [contenteditable=true], summary';
  for (const el of document.querySelectorAll(pick)) {
    if (seen.has(el)) continue; seen.add(el);
    const r = el.getBoundingClientRect();
    if (r.width < 3 || r.height < 3) continue;
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0) continue;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
    const inView = r.bottom > 0 && r.top < innerHeight * 3;
    if (!inView) continue;
    n += 1;
    el.setAttribute('data-smaran-id', String(n));
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    const label = (el.getAttribute('aria-label') || el.innerText || el.value
      || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('alt')
      || el.getAttribute('name') || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    out.push({ id: n, tag, type, role: el.getAttribute('role') || '', label,
      href: tag === 'a' ? (el.getAttribute('href') || '').slice(0, 120) : '' });
    if (n >= 80) break;
  }
  const text = (document.body ? document.body.innerText : '').replace(/\n{3,}/g, '\n\n');
  return { url: location.href, title: document.title, elements: out, text: text.slice(0, 3500) };
})()
"""


class LiveBrowser:
    """One visible browser window, from start to close."""

    def __init__(self) -> None:
        self.process: Optional[subprocess.Popen] = None
        self.profile = ""
        self.port = 0
        self._ws = None
        self._id = 0
        self._lock = threading.Lock()
        self.last: Dict[str, Any] = {}
        # A navigation the browser was stopped from making, reported on the
        # next step that moves the page.
        self.blocked = ""

    # -- lifetime --------------------------------------------------------

    def start(self) -> None:
        executable = find_browser()
        if not executable:
            raise Refused("No Chrome, Chromium, Edge or Brave was found on this computer. Install one "
                          "of them to use live browsing.")
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            self.port = s.getsockname()[1]
        self.profile = tempfile.mkdtemp(prefix="smaran-live-browser-")
        args = [
            executable,
            "--remote-debugging-port=%d" % self.port,
            "--remote-debugging-address=127.0.0.1",
            "--user-data-dir=%s" % self.profile,
            "--no-first-run", "--no-default-browser-check", "--disable-extensions",
            "--disable-sync", "--disable-features=Translate,OptimizationHints",
            "--window-size=1280,900", "--new-window", "about:blank",
        ]
        if sys.platform.startswith("linux"):
            # No screen to draw on - WSL without a GUI, a server, SSH - and a
            # windowed browser exits at once. Headless still reads, clicks and
            # types, and the screenshots below are how you watch it.
            if not (os.getenv("DISPLAY") or os.getenv("WAYLAND_DISPLAY")):
                args.insert(1, "--headless=new")
            # Chromium refuses to start as root without this (containers,
            # some WSL setups).
            if hasattr(os, "geteuid") and os.geteuid() == 0:
                args.insert(1, "--no-sandbox")
        flags = subprocess.CREATE_NEW_PROCESS_GROUP if sys.platform == "win32" else 0
        self.process = subprocess.Popen(args, stdout=subprocess.DEVNULL,
                                        stderr=subprocess.DEVNULL, creationflags=flags)
        deadline = time.time() + 20
        target = None
        while time.time() < deadline and target is None:
            time.sleep(0.4)
            try:
                with urllib.request.urlopen("http://127.0.0.1:%d/json/list" % self.port,
                                            timeout=2) as response:
                    pages = [t for t in json.load(response) if t.get("type") == "page"]
                    target = pages[0] if pages else None
            except OSError:
                continue
        if not target:
            self.close()
            raise Refused("The browser started but could not be controlled. Close any "
                          "browser windows that are stuck and try again.")
        from websockets.sync.client import connect
        self._ws = connect(target["webSocketDebuggerUrl"], max_size=None, open_timeout=10)
        self.send("Page.enable")
        self.send("Runtime.enable")
        # Every page load - top level or frame - pauses here until it is
        # checked, so a link or redirect to this computer or the local network
        # is refused before a byte is fetched, not noticed after it loaded.
        self.send("Fetch.enable", {"patterns": [
            {"urlPattern": "*", "resourceType": "Document", "requestStage": "Request"}]})

    def close(self) -> None:
        try:
            if self._ws is not None:
                try:
                    self.send("Browser.close", timeout=3)
                except Exception:  # noqa: BLE001 - closing anyway
                    pass
                self._ws.close()
        except Exception:  # noqa: BLE001
            pass
        self._ws = None
        if self.process is not None:
            try:
                self.process.wait(timeout=5)
            except Exception:  # noqa: BLE001
                self.process.kill()
            self.process = None
        if self.profile:
            # The profile is the one place a session's cookies live. It goes.
            for _ in range(10):
                shutil.rmtree(self.profile, ignore_errors=True)
                if not os.path.exists(self.profile):
                    break
                time.sleep(0.5)
            self.profile = ""

    # -- protocol --------------------------------------------------------

    def send(self, method: str, params: Optional[dict] = None, timeout: float = STEP_TIMEOUT) -> dict:
        with self._lock:
            if self._ws is None:
                raise Refused("The browser window was closed.")
            self._id += 1
            wanted = self._id
            self._ws.send(json.dumps({"id": wanted, "method": method, "params": params or {}}))
            deadline = time.time() + timeout
            while True:
                remaining = deadline - time.time()
                if remaining <= 0:
                    raise Refused("The page did not respond in time.")
                try:
                    message = json.loads(self._ws.recv(timeout=remaining))
                except TimeoutError:
                    raise Refused("The page did not respond in time.")
                except Exception:  # noqa: BLE001 - socket gone: window closed
                    raise Refused("The browser window was closed.")
                if message.get("method") == "Fetch.requestPaused":
                    self._decide(message.get("params") or {})
                    continue
                if message.get("id") == wanted:
                    if "error" in message:
                        raise Refused(str(message["error"].get("message", "The browser refused.")))
                    return message.get("result", {})

    def _decide(self, params: dict) -> None:
        """Let a paused page load through, or refuse it. Called with the lock held."""
        request_id = params.get("requestId")
        url = (params.get("request") or {}).get("url", "")
        refuse = False
        if url.startswith(("http://", "https://")):
            try:
                check_url(url)
            except Refused:
                refuse = True
        elif not url.startswith(("about:", "data:", "blob:")):
            refuse = True
        self._id += 1
        if refuse:
            self.blocked = url
            command = {"id": self._id, "method": "Fetch.failRequest",
                       "params": {"requestId": request_id, "errorReason": "BlockedByClient"}}
        else:
            command = {"id": self._id, "method": "Fetch.continueRequest",
                       "params": {"requestId": request_id}}
        self._ws.send(json.dumps(command))

    def evaluate(self, expression: str) -> Any:
        result = self.send("Runtime.evaluate", {"expression": expression,
                                                "returnByValue": True, "awaitPromise": True})
        if result.get("exceptionDetails"):
            raise Refused("The page could not be read.")
        return result.get("result", {}).get("value")

    def _guard_where(self) -> None:
        """Leave at once if a page steered the browser somewhere local.

        check_url() vets the address the model asks for, but a page can
        redirect, or a link can point anywhere. So after every step that can
        move the browser, where it actually is gets the same test.
        """
        if self.blocked:
            self.blocked = ""
            raise Refused("That page tried to send the browser to an address on this computer "
                          "or the local network, so it was stopped.")
        try:
            href = str(self.evaluate("location.href") or "")
        except Refused:
            return
        if not href.startswith(("http://", "https://")):
            return
        try:
            check_url(href)
        except Refused:
            self.send("Page.navigate", {"url": "about:blank"})
            raise Refused("That page tried to send the browser to an address on this computer "
                          "or the local network, so it was stopped.")

    def _settle(self, seconds: float = 12.0) -> None:
        deadline = time.time() + seconds
        while time.time() < deadline:
            try:
                if self.evaluate("document.readyState") == "complete":
                    break
            except Refused:
                pass
            time.sleep(0.4)
        time.sleep(0.6)  # late scripts drawing the page

    # -- actions ---------------------------------------------------------

    def open(self, url: str) -> str:
        url = check_url(url)
        self.send("Page.navigate", {"url": url})
        self._settle()
        self._guard_where()
        return "Opened %s" % url

    def snapshot(self) -> Dict[str, Any]:
        self.last = self.evaluate(_SNAPSHOT_JS) or {}
        return self.last

    def _element(self, element_id: Any) -> Dict[str, Any]:
        try:
            wanted = int(element_id)
        except (TypeError, ValueError):
            raise Refused("Say which element by its number.")
        for element in self.last.get("elements", []):
            if element["id"] == wanted:
                return element
        raise Refused("There is no element #%s on this page any more." % element_id)

    def click(self, element_id: Any) -> str:
        element = self._element(element_id)
        label = element.get("label", "")
        if element["tag"] in ("button", "input") or element.get("role") == "button" \
                or element["tag"] == "a":
            if _IRREVERSIBLE.search(label):
                raise Refused("STOP: pressing \"%s\" could not be undone, so it was left for "
                              "you. Press it yourself in the browser window if you want to."
                              % label)
        found = self.evaluate(
            "(() => { const el = document.querySelector('[data-smaran-id=\"%d\"]');"
            " if (!el) return false; el.scrollIntoView({block: 'center'}); el.click(); return true; })()"
            % int(element_id))
        if not found:
            raise Refused("That element is no longer on the page.")
        self._settle(8)
        self._guard_where()
        return "Clicked \"%s\"" % (label or element["tag"])

    def type(self, element_id: Any, text: str, enter: bool = False) -> str:
        element = self._element(element_id)
        kind = (element.get("type") or "").lower()
        hint = (element.get("label") or "").lower()
        if kind == "password" or re.search(r"password|passcode|\bpin\b|otp|cvv|cvc|card number", hint):
            raise Refused("Passwords, PINs, one-time codes and card details are never typed by "
                          "the assistant. Enter them yourself in the browser window.")
        focused = self.evaluate(
            "(() => { const el = document.querySelector('[data-smaran-id=\"%d\"]');"
            " if (!el) return false; el.scrollIntoView({block: 'center'}); el.focus();"
            " if ('value' in el) { el.value = ''; el.dispatchEvent(new Event('input', {bubbles: true})); }"
            " return true; })()" % int(element_id))
        if not focused:
            raise Refused("That field is no longer on the page.")
        # insertText goes through the browser's own input path, so pages built
        # with React and friends see real typing rather than a changed value.
        self.send("Input.insertText", {"text": str(text)[:2000]})
        if enter:
            # The "\r" text is what makes it a real Enter: without it Chrome
            # dispatches the key but submits no form, and the search that was
            # typed simply sat in the box.
            self.send("Input.dispatchKeyEvent", {"type": "keyDown", "key": "Enter", "code": "Enter",
                                                 "text": "\r", "unmodifiedText": "\r",
                                                 "windowsVirtualKeyCode": 13,
                                                 "nativeVirtualKeyCode": 13})
            self.send("Input.dispatchKeyEvent", {"type": "keyUp", "key": "Enter", "code": "Enter",
                                                 "windowsVirtualKeyCode": 13,
                                                 "nativeVirtualKeyCode": 13})
            self._settle(10)
            self._guard_where()
        return "Typed into \"%s\"%s" % (element.get("label") or element["tag"],
                                         " and pressed Enter" if enter else "")

    def scroll(self, direction: str = "down") -> str:
        amount = -700 if str(direction).lower().startswith("u") else 700
        self.evaluate("window.scrollBy(0, %d)" % amount)
        time.sleep(0.5)
        return "Scrolled %s" % ("up" if amount < 0 else "down")

    def back(self) -> str:
        self.evaluate("history.back()")
        self._settle(8)
        self._guard_where()
        return "Went back"

    def screenshot(self) -> str:
        """A small JPEG of what is on screen, as a data URL for the chat."""
        try:
            shot = self.send("Page.captureScreenshot", {"format": "jpeg", "quality": 55})
            return "data:image/jpeg;base64," + shot.get("data", "")
        except Refused:
            return ""


# ---------------------------------------------------------------------------
# The agent
# ---------------------------------------------------------------------------

SYSTEM = """You operate a real web browser for a person, one action at a time.

Each turn you are shown the task, what you have done so far, and the current
page: its address, title, a numbered list of things you can press or type
into, and its readable text.

Reply with ONE JSON object and nothing else:
  {"thought": "why, in one short sentence", "action": "open", "url": "https://..."}
  {"thought": "...", "action": "click", "id": 12}
  {"thought": "...", "action": "type", "id": 7, "text": "what to type", "enter": true}
  {"thought": "...", "action": "scroll", "direction": "down"}
  {"thought": "...", "action": "back"}
  {"thought": "...", "action": "done", "answer": "the answer, with the facts you found"}

Rules:
- Start by opening a relevant site or a search engine (https://duckduckgo.com/?q=...).
- Use only the numbers shown in the element list.
- Never try to sign in, pay, buy, send, post, delete or submit anything. If the
  task needs that, stop with "done" and say what the person should do.
- Never answer from memory. Use "done" only when the answer appears in the
  CURRENT PAGE text or in the results of your earlier steps - if it does not,
  keep going (open the result, scroll, search again). If you truly cannot find
  it, say so in "answer" rather than guessing.
- After typing into a search box with "enter": true, check the ADDRESS changed.
  If it did not, click the search button instead.
- Finish with "done" as soon as you can answer. Answer in the language the task
  was written in."""


def _page_for_model(page: Dict[str, Any]) -> str:
    lines = ["ADDRESS: %s" % page.get("url", ""), "TITLE: %s" % page.get("title", ""),
             "ELEMENTS:"]
    for element in page.get("elements", [])[:80]:
        kind = element["tag"] + ("[%s]" % element["type"] if element.get("type") else "")
        extra = (" -> %s" % element["href"]) if element.get("href") else ""
        lines.append("  #%d %s \"%s\"%s" % (element["id"], kind, element.get("label", ""), extra))
    lines.append("TEXT:")
    lines.append(page.get("text", "")[:3500])
    return "\n".join(lines)


def _parse_action(reply: str) -> Optional[Dict[str, Any]]:
    reply = re.sub(r"```(?:json)?", "", reply or "")
    start = reply.find("{")
    while start != -1:
        depth = 0
        for index in range(start, len(reply)):
            if reply[index] == "{":
                depth += 1
            elif reply[index] == "}":
                depth -= 1
                if depth == 0:
                    try:
                        parsed = json.loads(reply[start:index + 1])
                        if isinstance(parsed, dict) and parsed.get("action"):
                            return parsed
                    except json.JSONDecodeError:
                        pass
                    break
        start = reply.find("{", start + 1)
    return None


Emit = Callable[[Dict[str, Any]], None]


def run_task(task: str, emit: Emit, stopped: Callable[[], bool],
             ask: Optional[Callable[[str, str], tuple]] = None,
             browser: Optional[LiveBrowser] = None) -> None:
    """Carry out one browsing task, reporting each step through emit().

    ask(system, user) -> (text, error) is the model; by default the same
    chain Sites uses - saved provider keys first, then local Ollama.
    """
    task = (task or "").strip()
    if not task:
        emit({"type": "error", "message": "Say what to look for."})
        return
    if ask is None:
        from . import site_builder
        generators, skipped = site_builder.candidates()
        if not generators:
            emit({"type": "error", "message": site_builder.nothing_available(skipped)})
            return

        def ask(system: str, user: str, _chain=generators) -> tuple:  # type: ignore[no-redef]
            last = ""
            for generator in list(_chain):
                text, error = site_builder.ask(generator, system, user)
                if text:
                    # Keep the one that answered in front for the next step.
                    _chain.remove(generator)
                    _chain.insert(0, generator)
                    return text, ""
                last = error
            return "", last or "No model answered."

    browser = browser or LiveBrowser()
    history: List[str] = []
    try:
        emit({"type": "status", "message": "Opening a browser window on this computer..."})
        browser.start()
        for step in range(1, MAX_STEPS + 1):
            if stopped():
                emit({"type": "stopped", "message": "Stopped."})
                return
            try:
                page = browser.snapshot()
            except Refused as exc:
                emit({"type": "error", "message": str(exc)})
                return
            user = "TASK: %s\n\nDONE SO FAR:\n%s\n\nCURRENT PAGE:\n%s" % (
                task, "\n".join(history[-8:]) or "(nothing yet)", _page_for_model(page))
            reply, error = ask(SYSTEM, user)
            if error and not reply:
                emit({"type": "error", "message": "The model did not answer: %s" % error})
                return
            action = _parse_action(reply)
            if action is None:
                reply, _ = ask(SYSTEM, user + "\n\nYour last reply was not one JSON object. "
                                              "Reply with exactly one JSON action.")
                action = _parse_action(reply)
            if action is None:
                emit({"type": "error", "message": "The model did not choose an action it could run."})
                return

            kind = str(action.get("action", "")).lower()
            thought = str(action.get("thought", ""))[:300]
            if kind == "done":
                emit({"type": "done", "step": step, "answer": str(action.get("answer", "")).strip()
                      or "Finished, but the model gave no answer.", "url": page.get("url", ""),
                      "screenshot": browser.screenshot()})
                return
            try:
                if kind == "open":
                    result = browser.open(str(action.get("url", "")))
                elif kind == "click":
                    result = browser.click(action.get("id"))
                elif kind == "type":
                    result = browser.type(action.get("id"), str(action.get("text", "")),
                                          bool(action.get("enter")))
                elif kind == "scroll":
                    result = browser.scroll(str(action.get("direction", "down")))
                elif kind == "back":
                    result = browser.back()
                else:
                    result = "There is no action called %r." % kind
            except Refused as exc:
                result = str(exc)
                if result.startswith("STOP:"):
                    emit({"type": "step", "step": step, "action": kind, "thought": thought,
                          "result": result[6:], "url": page.get("url", ""),
                          "screenshot": browser.screenshot()})
                    emit({"type": "done", "step": step, "answer": result[6:],
                          "url": page.get("url", ""), "screenshot": ""})
                    return
            history.append("%d. %s %s -> %s" % (step, kind, json.dumps(
                {k: v for k, v in action.items() if k not in ("thought", "action")})[:160], result))
            try:
                current = browser.evaluate("location.href") or ""
            except Refused:
                current = ""
            emit({"type": "step", "step": step, "action": kind, "thought": thought,
                  "result": result, "url": current, "screenshot": browser.screenshot()})
        emit({"type": "done", "step": MAX_STEPS, "answer":
              "I stopped after %d steps without a final answer - the screenshot above is "
              "where it got to. Try asking more specifically." % MAX_STEPS, "url": "", "screenshot": ""})
    except Refused as exc:
        emit({"type": "error", "message": str(exc)})
    except Exception as exc:  # noqa: BLE001 - reported, never raised into the route
        logger.warning("live browsing failed", exc_info=True)
        emit({"type": "error", "message": "Live browsing failed: %s" % str(exc)[:200]})
    finally:
        browser.close()
