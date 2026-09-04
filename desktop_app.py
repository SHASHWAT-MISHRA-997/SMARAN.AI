"""
SMARAN.AI — Standalone Desktop Application
==========================================
A single, self-contained Windows executable. No Docker, no containers, no
sign-in, no internet requirement to start.

What it does, in order:
  1. Picks a free local port.
  2. Starts the bundled FastAPI backend in a background thread (in-process).
  3. Waits until the server actually answers a health check, so the UI is
     never opened against a dead port ("This site can't be reached").
  4. Opens the workspace in an app window (native webview when available,
     otherwise a chrome-less browser window, otherwise the default browser).
  5. Keeps running until the window is closed, then shuts down cleanly.

Build a distributable EXE with:
    python build_exe.py
"""

from __future__ import annotations

import os
import socket
import sys
import threading
import time
import urllib.error
import urllib.request

APP_NAME = "SMARAN.AI"
HEALTH_PATH = "/api/test/ping"
STARTUP_TIMEOUT_SECONDS = 180


# ---------------------------------------------------------------------------
# Paths — a frozen build keeps code in a temp dir but user data next to the EXE
# ---------------------------------------------------------------------------
class _NullStream:
    """A stand-in for a missing stdout/stderr.

    A windowed PyInstaller build has no console, so `sys.stdout` and
    `sys.stderr` are None. Libraries that probe them — uvicorn's log formatter
    calls `sys.stdout.isatty()` — crash on startup without this.
    """

    encoding = "utf-8"

    def write(self, _data):  # noqa: D401 - file-like API
        return 0

    def flush(self):
        return None

    def isatty(self):
        return False

    def fileno(self):
        raise OSError("no console is attached to this process")


def _ensure_standard_streams() -> None:
    if sys.stdout is None:
        sys.stdout = _NullStream()
    if sys.stderr is None:
        sys.stderr = _NullStream()


def _is_frozen() -> bool:
    return bool(getattr(sys, "frozen", False))


def _bundle_dir() -> str:
    """Directory holding bundled resources (code, frontend_dist)."""
    if _is_frozen():
        return getattr(sys, "_MEIPASS", os.path.dirname(sys.executable))
    return os.path.dirname(os.path.abspath(__file__))


def _user_data_dir() -> str:
    """Writable directory for the database, uploads, models and vector store.

    Kept out of the read-only bundle so data survives upgrades.

    One place per platform, and each one is where that platform expects an
    application to keep things. The fallback used to be the home directory on
    anything that was not Windows, which on Linux means a bare ~/SMARAN.AI
    folder sitting among somebody's own files - the same rudeness this project
    already refuses when it declines to drop a 267 MB installer in Downloads.

    DATA_DIR wins if it is set. It is how this is pointed somewhere else for a
    test, and how somebody keeps their data on another disk.
    """
    told = os.environ.get("DATA_DIR")
    if told:
        return told
    if not _is_frozen():
        return os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
    if sys.platform == "win32":
        base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
        return os.path.join(base, "SMARAN.AI", "data")
    if sys.platform == "darwin":
        return os.path.join(os.path.expanduser("~"), "Library",
                            "Application Support", "SMARAN.AI", "data")
    # Linux and the rest: the XDG base directory, which is what a desktop
    # environment backs up, syncs and shows in its own tools.
    base = os.environ.get("XDG_DATA_HOME") or os.path.join(
        os.path.expanduser("~"), ".local", "share")
    return os.path.join(base, "SMARAN.AI", "data")


def _prepare_environment() -> None:
    """Point the backend at the writable data directory before it is imported."""
    data_dir = _user_data_dir()
    os.makedirs(data_dir, exist_ok=True)
    os.environ.setdefault("DATA_DIR", data_dir)
    os.environ.setdefault("HF_HOME", os.path.join(data_dir, "models"))
    os.environ.setdefault("HUGGINGFACE_HUB_CACHE", os.path.join(data_dir, "models", "hub"))

    bundle = _bundle_dir()

    # nltk looks for its corpora in a fixed set of places, none of which is
    # inside a frozen bundle. The data is shipped - _internal/nltk_data - and
    # was simply never pointed at, so g2p-en could not build its tagger and
    # the offline voice reported itself unavailable while its files sat there.
    nltk_data = os.path.join(bundle, "nltk_data")
    if os.path.isdir(nltk_data):
        existing = os.environ.get("NLTK_DATA", "")
        os.environ["NLTK_DATA"] = (nltk_data + os.pathsep + existing) if existing else nltk_data

    # The backend package lives at <bundle>/backend/app in source checkouts and
    # at <bundle>/app once frozen; make both importable as `app`.
    for candidate in (os.path.join(bundle, "backend"), bundle):
        if os.path.isdir(os.path.join(candidate, "app")) and candidate not in sys.path:
            sys.path.insert(0, candidate)


def _runtime_file() -> str:
    """Where the running app advertises the port it actually bound to."""
    return os.path.join(_user_data_dir(), "runtime.json")


def _advertise_port(port: int) -> None:
    """Publish the live port so companion tools can find this instance.

    The VS Code extension reads this instead of guessing a fixed port, which
    would break whenever the preferred port is already taken.
    """
    import json

    try:
        with open(_runtime_file(), "w", encoding="utf-8") as handle:
            json.dump({"port": port, "url": f"http://127.0.0.1:{port}", "pid": os.getpid()}, handle)
    except OSError as exc:
        sys.stderr.write(f"{APP_NAME}: could not publish runtime port: {exc}\n")


def _clear_advertised_port() -> None:
    try:
        os.remove(_runtime_file())
    except OSError:
        pass


def _find_free_port(preferred: int = 3003) -> int:
    """Return `preferred` when free, else an arbitrary free port."""
    for port in (preferred, 0):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                probe.bind(("0.0.0.0", port))
                return probe.getsockname()[1]
            except OSError:
                continue
    raise RuntimeError("No free local port is available")


# ---------------------------------------------------------------------------
# Backend
# ---------------------------------------------------------------------------
class _BackendServer:
    def __init__(self, port: int):
        self.port = port
        self._server = None
        self._thread = None
        self.error: BaseException | None = None

    def start(self) -> None:
        # Any of this can fail: a module the packaged build did not include,
        # a port already taken, a database that will not open. When it did,
        # the window still appeared and the whole interface showed
        # 'unavailable' with no way to find out why, so the reason is now
        # written down instead of being lost.
        try:
            import uvicorn

            from app.main import app as fastapi_app
        except BaseException as exc:
            self.error = exc
            _log_startup_failure(exc)
            raise

        # Bound to every interface, not just loopback. "Link your phone"
        # hands the phone this machine's LAN address, and on loopback
        # nothing was listening there - the QR pointed at an address that
        # refused the connection, which is what "site can't be reached"
        # was.
        #
        # What this opens, and what it does not: requests still need a
        # session, CORS already refuses any origin outside localhost and
        # the private ranges, and pairing needs a six-digit code that
        # expires. The exposure is to the local network only.
        config = uvicorn.Config(
            fastapi_app,
            host="0.0.0.0",
            port=self.port,
            log_level="warning",
            access_log=False,
            # Skip uvicorn's console log setup: it builds a colourised formatter
            # against sys.stdout, which a windowed build does not have.
            log_config=None,
        )
        self._server = uvicorn.Server(config)

        def _run() -> None:
            try:
                self._server.run()
            except BaseException as exc:  # noqa: BLE001 - surfaced to the user
                self.error = exc
                _log_startup_failure(exc)

        self._thread = threading.Thread(target=_run, name="smaran-backend", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        if self._server is not None:
            self._server.should_exit = True
        if self._thread is not None:
            self._thread.join(timeout=10)


def _wait_until_ready(port: int, timeout: float = STARTUP_TIMEOUT_SECONDS,
                      server: "_BackendServer | None" = None) -> bool:
    """Block until the server answers, so the UI never opens on a dead port."""
    url = f"http://127.0.0.1:{port}{HEALTH_PATH}"
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if server is not None and server.error is not None:
            return False
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if response.status < 500:
                    # An answer on this port is not proof that *our* server is
                    # the one answering. Start a second copy while the first
                    # holds the port and this check passes on the first one's
                    # reply, so the second opens a window backed by a server
                    # that never started - which is what a window where
                    # everything reads "unavailable" actually was.
                    #
                    # A bind failure surfaces on the serving thread a moment
                    # after the attempt, so the reply is confirmed rather than
                    # trusted immediately.
                    if server is not None:
                        time.sleep(0.6)
                        if server.error is not None:
                            return False
                    return True
        except (urllib.error.URLError, OSError):
            pass
        time.sleep(0.4)
    return False


#: One name, so a second copy can find the first before either does anything.
#: Windows keeps this in the kernel, which is what makes the check atomic -
#: two copies starting in the same instant cannot both win it.
SINGLE_INSTANCE_MUTEX = r"Global\SMARAN.AI.SingleInstance"

_instance_handle = None


def _claim_single_instance() -> bool:
    """True if this process is the only copy. False if another already holds it.

    The check that was here read a file and then pinged a port - two steps
    with a gap between them, and during "Restart & Install" that gap is
    exactly when a second copy starts. Both would read "nothing running" and
    both would carry on. That is how several windows ended up in the taskbar.

    A named mutex has no gap. Creating it and learning that it already existed
    is one operation inside the kernel, so of two copies starting together,
    exactly one wins.

    The handle is kept in a module-level name on purpose: dropping it would
    let Python collect it and release the mutex while the app is still
    running, which would put the race straight back.
    """
    global _instance_handle

    if sys.platform != "win32":
        # No equivalent kernel object here. The port check below is what this
        # falls back to, and it is honest about being weaker.
        return True
    try:
        import ctypes
        from ctypes import wintypes

        ERROR_ALREADY_EXISTS = 183
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.CreateMutexW.restype = wintypes.HANDLE
        handle = kernel32.CreateMutexW(None, wintypes.BOOL(True), SINGLE_INSTANCE_MUTEX)
        if not handle:
            return True
        if ctypes.get_last_error() == ERROR_ALREADY_EXISTS:
            kernel32.CloseHandle(handle)
            return False
        _instance_handle = handle
        return True
    except Exception:
        # A guard that cannot be set up must not stop the app from starting.
        return True


def _existing_instance() -> "int | None":
    """The port of a copy that is already running, if one is answering.

    Opening a second copy has no use and one real cost: two windows that look
    identical, one of which cannot work. Better to raise the one already
    there.
    """
    import json

    try:
        with open(_runtime_file(), "r", encoding="utf-8") as handle:
            recorded = json.load(handle)
    except (OSError, ValueError):
        return None

    port = recorded.get("port")
    if not isinstance(port, int):
        return None
    try:
        with urllib.request.urlopen(
                f"http://127.0.0.1:{port}{HEALTH_PATH}", timeout=2) as response:
            if response.status < 500:
                return port
    except (urllib.error.URLError, OSError):
        return None
    return None


def _raise_existing_window() -> bool:
    """Bring the running copy's window to the front. True if one was found."""
    if sys.platform != "win32":
        return False
    try:
        import ctypes

        hwnd = ctypes.windll.user32.FindWindowW(None, APP_NAME)
        if not hwnd:
            return False
        ctypes.windll.user32.ShowWindow(hwnd, 9)      # SW_RESTORE
        ctypes.windll.user32.SetForegroundWindow(hwnd)
        return True
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Window
# ---------------------------------------------------------------------------
def _log_startup_failure(exc: BaseException) -> None:
    """Record why the backend did not come up, beside the user data."""
    import traceback

    try:
        path = os.path.join(_user_data_dir(), "backend-error.log")
        with open(path, "a", encoding="utf-8") as handle:
            handle.write(time.strftime('%Y-%m-%d %H:%M:%S') + chr(10))
            handle.write(''.join(traceback.format_exception(type(exc), exc, exc.__traceback__)))
            handle.write(chr(10))
    except Exception:
        pass


def _media_log(message: str) -> None:
    """Record what the permission patch did, next to the user's data.

    The packaged window swallows stdout, so without this there is no way to
    tell whether the patch applied or why it did not.
    """
    try:
        path = os.path.join(_user_data_dir(), "webview-permissions.log")
        with open(path, "a", encoding="utf-8") as handle:
            handle.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')}  {message}" + chr(10))
    except Exception:
        pass


def _grant_webview2_media_permissions() -> None:
    """Let the app window use the microphone, camera and audio playback.

    pywebview's WebView2 backend never handles ``PermissionRequested``, and a
    request nobody answers is denied. That is why the packaged app sat on
    "waiting for microphone permission" however the Windows privacy settings
    were set, and why the background ambience stayed silent: autoplay is gated
    the same way.

    Only the app's own pages can ask, since the workspace is served from
    ``127.0.0.1``, so granting these outright matches what launching the app
    already implies. Every other permission keeps its default.
    """
    try:
        import webview.platforms.edgechromium as edge
    except Exception as exc:
        _media_log(f"edgechromium backend unavailable: {exc!r}")
        return

    # Permission kinds and states are .NET enums. Importing them by name works
    # from source but not reliably from a frozen build, so the values are read
    # off the live objects instead and the import is only a fast path.
    enums = {}
    try:
        from Microsoft.Web.WebView2.Core import (  # type: ignore[import-not-found]
            CoreWebView2PermissionKind,
            CoreWebView2PermissionState,
        )

        enums["allow"] = CoreWebView2PermissionState.Allow
        enums["kinds"] = {
            CoreWebView2PermissionKind.Microphone,
            CoreWebView2PermissionKind.Camera,
            CoreWebView2PermissionKind.Autoplay,
        }
        _media_log("permission enums imported")
    except Exception as exc:
        _media_log(f"permission enums unavailable, using names: {exc!r}")

    wanted_names = {"Microphone", "Camera", "Autoplay"}

    original_init = edge.EdgeChrome.__init__
    original_ready = edge.EdgeChrome.on_webview_ready

    def patched_init(self, *args, **kwargs):
        original_init(self, *args, **kwargs)
        try:
            # Chromium gates audio playback behind a user gesture even once the
            # permission is granted, and the ambience bed starts on its own.
            properties = self.webview.CreationProperties
            properties.AdditionalBrowserArguments += (
                " --autoplay-policy=no-user-gesture-required"
            )
            # Opens Chromium's debugging port so the page inside this window
            # can be inspected from outside it. Off unless SMARAN_DEBUG_PORT is
            # set, because a debugging port left open is a way into the app.
            # Without it there is no way to see a console error in the packaged
            # window at all - the only evidence of a fault is a person saying
            # it did not work.
            debug_port = os.environ.get("SMARAN_DEBUG_PORT", "").strip()
            if debug_port.isdigit():
                properties.AdditionalBrowserArguments += (
                    f" --remote-debugging-port={debug_port}"
                )
            _media_log(f"browser args: {self.webview.CreationProperties.AdditionalBrowserArguments}")
        except Exception as exc:
            _media_log(f"could not extend browser args: {exc!r}")

    def patched_ready(self, sender, args):
        original_ready(self, sender, args)
        try:
            core = self.webview.CoreWebView2

            def on_permission(_sender, event):
                try:
                    kind = event.PermissionKind
                    granted = (
                        kind in enums["kinds"]
                        if "kinds" in enums
                        else str(kind) in wanted_names
                    )
                    if granted:
                        if "allow" in enums:
                            event.State = enums["allow"]
                        else:
                            # CoreWebView2PermissionState: Default 0, Allow 1, Deny 2.
                            event.State = 1
                    _media_log(f"request {kind} -> {'allow' if granted else 'default'}")
                except Exception as exc:
                    _media_log(f"permission handler failed: {exc!r}")

            core.PermissionRequested += on_permission
            _media_log("permission handler attached")
        except Exception as exc:
            _media_log(f"could not attach permission handler: {exc!r}")

    edge.EdgeChrome.__init__ = patched_init
    edge.EdgeChrome.on_webview_ready = patched_ready
    _media_log("patch installed")


def _open_window(url: str) -> bool:
    """Open a real app window. Returns True if it blocked until closed."""
    try:
        import webview  # pywebview: native window, no browser chrome

        _grant_webview2_media_permissions()
        window = webview.create_window(APP_NAME, url, width=1440, height=900,
                                       min_size=(260, 340), confirm_close=False)
        # Hand the window to the backend, which runs in this same process, so
        # picture-in-picture can shrink and pin the real window rather than
        # only shrinking a panel inside the page. A panel floats over the page;
        # the window floats over everything else, which is the point.
        #
        # min_size is the floor the window cannot go below, and it has twice
        # been the reason picture-in-picture came out bigger than asked for:
        # (900, 600) refused the resize outright, then (360, 480) silently
        # clamped a 320x440 request back up to 360x480. It is now below the
        # smallest mode, so the size that is asked for is the size that
        # happens.
        try:
            from app.host_window import register as register_window
            register_window(window)
        except Exception:
            logger.info("Picture-in-picture is unavailable: the window could not be registered.")
        webview.start()
        return True
    except Exception:
        pass

    # Fall back to a chrome-less browser app window.
    import shutil
    import subprocess

    for browser in _BROWSERS:
        binary = shutil.which(browser)
        if binary:
            try:
                subprocess.Popen([binary, f"--app={url}", "--new-window"])
                return False
            except Exception:
                continue

    import webbrowser

    webbrowser.open(url)
    return False


# Browsers that can open a window with no address bar, by the names they
# actually have on each platform.
#
# The list used to be ("chrome", "msedge", "brave") everywhere. On Linux none
# of those three names exist - the binaries are google-chrome, chromium,
# brave-browser - so on a machine with Chrome installed the search found
# nothing and the app opened in an ordinary tab with the browser's whole
# interface around it. It worked, and it looked like something else's website.
_BROWSERS = (
    ("chrome", "msedge", "brave") if sys.platform == "win32"
    else ("google-chrome-stable", "google-chrome", "chromium-browser", "chromium",
          "brave-browser", "microsoft-edge-stable", "microsoft-edge", "vivaldi")
    if sys.platform.startswith("linux")
    else ("Google Chrome", "chrome", "Brave Browser", "Microsoft Edge")
)


def _report_fatal(message: str) -> None:
    """Show a readable error instead of a silent crash or a dead browser tab."""
    sys.stderr.write(f"{APP_NAME}: {message}\n")
    try:
        import ctypes

        ctypes.windll.user32.MessageBoxW(None, message, f"{APP_NAME} — Startup Error", 0x10)
    except Exception:
        pass


def _run_tts_worker(argv: list[str]) -> int:
    """Speech-worker mode: `SMARAN.AI.exe --tts-worker <voice> <rate> <out> <textfile>`.

    The API server shells out to this so neural speech synthesis runs in a clean
    process, away from libraries the server has already loaded. The text arrives
    in a UTF-8 file because Windows mangles non-Latin command-line arguments.
    """
    if len(argv) < 5:
        return 2
    voice, rate, out_path, text_path = argv[1], argv[2], argv[3], argv[4]
    with open(text_path, encoding="utf-8") as handle:
        text = handle.read()

    import asyncio

    import edge_tts

    async def render() -> None:
        communicator = edge_tts.Communicate(text, voice, rate=rate)
        with open(out_path, "wb") as handle:
            async for chunk in communicator.stream():
                if chunk.get("type") == "audio" and chunk.get("data"):
                    handle.write(chunk["data"])

    try:
        asyncio.run(render())
    except Exception as exc:  # noqa: BLE001
        sys.stderr.write(f"tts-worker failed: {exc}\n")
        return 1
    return 0


def main() -> int:
    _ensure_standard_streams()

    # Before anything runs a command. This build has no console of its own, so
    # every child process was given one - a black window opening and closing
    # wherever the app shelled out. Turning a plugin on produced a burst of
    # them, because the plugins check for their command line by running it.
    try:
        from app.no_console import install as _suppress_consoles

        _suppress_consoles()
    except Exception:
        # A cosmetic fix must never be the reason the app fails to start.
        pass

    if len(sys.argv) > 1 and sys.argv[1] == "--tts-worker":
        return _run_tts_worker(sys.argv[1:])

    _prepare_environment()

    # One copy is enough. Opening a second gives two identical windows, and
    # the second one cannot work: the first holds the port, so the second's
    # engine fails to start while its window opens anyway and shows every
    # feature as unavailable. Double-clicking the shortcut twice was enough
    # to produce it, and there was nothing on screen to say which window was
    # the broken one.
    # Asked first, because it cannot be raced. The port check underneath is
    # still useful on platforms with no mutex, and for a copy that is running
    # from a different install.
    if not _claim_single_instance():
        _raise_existing_window()
        print(f"{APP_NAME} is already running.")
        return 0

    running = _existing_instance()
    if running is not None:
        _raise_existing_window()
        print(f"{APP_NAME} is already running at http://127.0.0.1:{running}/")
        return 0

    try:
        port = _find_free_port()
    except RuntimeError as exc:
        _report_fatal(str(exc))
        return 1

    server = _BackendServer(port)
    try:
        server.start()
    except BaseException as exc:  # noqa: BLE001
        _report_fatal(f"The local engine could not start:\n\n{exc}")
        return 1

    if not _wait_until_ready(port, server=server):
        detail = f"\n\n{server.error}" if server.error else ""
        _report_fatal(
            "The local engine did not become ready in time, so the window was "
            f"not opened.{detail}"
        )
        server.stop()
        return 1

    url = f"http://127.0.0.1:{port}/"
    _advertise_port(port)
    try:
        blocked = _open_window(url)

        if not blocked:
            # No native window to wait on: keep the engine alive until interrupted.
            print(f"{APP_NAME} is running at {url}\nClose this window to quit.")
            try:
                while True:
                    time.sleep(1)
            except KeyboardInterrupt:
                pass
    finally:
        _clear_advertised_port()
        server.stop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
