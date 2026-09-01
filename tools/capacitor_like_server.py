"""Serve the built interface the way the Android shell serves it.

Capacitor's WebViewLocalServer answers every request whose last path segment
has no dot with index.html, status 200. That includes /api/... - so inside the
APK the app's own HTML shell comes back where JSON was expected. Reproducing
that here is the only way to see on this machine what the phone sees.

Not part of the app. A test fixture, kept so the next person can check it.
"""

from __future__ import annotations

import os
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler

ROOT = sys.argv[1] if len(sys.argv) > 1 else "backend/frontend_dist"
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 5199


#: The shell also injects its bridge object before the app's own script runs,
#: which is how the app knows it is on a phone. ?native=1 reproduces that much
#: of it - enough to see what the packaged app shows, not a Capacitor stand-in.
BRIDGE = (
    b"<script>window.Capacitor={isNativePlatform:function(){return true;},"
    b"isNative:true,getPlatform:function(){return 'android';}};</script>"
)


class CapacitorLike(SimpleHTTPRequestHandler):
    def translate_path(self, path: str) -> str:
        clean = path.split("?", 1)[0].split("#", 1)[0]
        last = clean.rstrip("/").rsplit("/", 1)[-1]
        if clean == "/" or "." not in last:
            return os.path.join(ROOT, "index.html")
        return os.path.join(ROOT, clean.lstrip("/"))

    def do_GET(self):
        if "native=1" in self.path and "." not in self.path.split("?")[0].rsplit("/", 1)[-1]:
            with open(os.path.join(ROOT, "index.html"), "rb") as handle:
                body = handle.read().replace(b"<head>", b"<head>" + BRIDGE, 1)
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def do_POST(self):
        # The real shell has no idea this is meant to be an API call either;
        # it hands back the same page with a 200. That is the whole bug.
        self.do_GET()

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    print("serving %s on http://127.0.0.1:%d" % (ROOT, PORT))
    HTTPServer(("127.0.0.1", PORT), CapacitorLike).serve_forever()
