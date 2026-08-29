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
    """
    if _is_frozen():
        base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
        return os.path.join(base, "SMARAN.AI", "data")
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")


def _prepare_environment() -> None:
    """Point the backend at the writable data directory before it is imported."""
    data_dir = _user_data_dir()
    os.makedirs(data_dir, exist_ok=True)
    os.environ.setdefault("DATA_DIR", data_dir)
    os.environ.setdefault("HF_HOME", os.path.join(data_dir, "models"))
    os.environ.setdefault("HUGGINGFACE_HUB_CACHE", os.path.join(data_dir, "models", "hub"))

    bundle = _bundle_dir()
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
                    return True
        except (urllib.error.URLError, OSError):
            pass
        time.sleep(0.4)
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
                                       min_size=(360, 480), confirm_close=False)
        # Hand the window to the backend, which runs in this same process, so
        # picture-in-picture can shrink and pin the real window rather than
        # only shrinking a panel inside the page. A panel floats over the page;
        # the window floats over everything else, which is the point.
        #
        # min_size was (900, 600) - larger than the 420x560 picture-in-picture
        # size, so the resize would have been refused.
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

    for browser in ("chrome", "msedge", "brave"):
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

    if len(sys.argv) > 1 and sys.argv[1] == "--tts-worker":
        return _run_tts_worker(sys.argv[1:])

    _prepare_environment()

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
