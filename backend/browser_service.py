"""Isolated browser renderer for public JavaScript pages."""
import ipaddress
import socket
import threading
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="Smaran Public Web Renderer")
_lock = threading.Lock()
_playwright = None
_browser = None


class RenderRequest(BaseModel):
    url: str


def _validate_public_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Only public http/https URLs are supported")
    if parsed.port not in {None, 80, 443}:
        raise ValueError("Only web ports 80 and 443 are supported")
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    addresses = {item[4][0] for item in socket.getaddrinfo(parsed.hostname, port, type=socket.SOCK_STREAM)}
    for address in addresses:
        ip = ipaddress.ip_address(address)
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
            raise ValueError("Private, local, reserved, and metadata-network URLs are blocked")


def _route_request(route) -> None:
    request_url = route.request.url
    scheme = urlparse(request_url).scheme
    if scheme in {"about", "blob", "data"}:
        route.continue_()
        return
    try:
        _validate_public_url(request_url)
        route.continue_()
    except Exception:
        route.abort()


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/render")
def render(request: RenderRequest):
    global _playwright, _browser
    try:
        _validate_public_url(request.url)
    except Exception as exc:
        raise HTTPException(400, str(exc))
    with _lock:
        context = None
        try:
            from playwright.sync_api import sync_playwright
            if _playwright is None:
                _playwright = sync_playwright().start()
                _browser = _playwright.chromium.launch(
                    headless=True,
                    args=["--disable-dev-shm-usage", "--no-sandbox"],
                )
            context = _browser.new_context(
                java_script_enabled=True,
                accept_downloads=False,
                ignore_https_errors=False,
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
            )
            page = context.new_page()
            page.route("**/*", _route_request)
            page.goto(request.url, wait_until="domcontentloaded", timeout=25000)
            try:
                page.wait_for_load_state("networkidle", timeout=5000)
            except Exception:
                pass
            _validate_public_url(page.url)
            title = page.title().strip()
            text = ""
            for selector in ("main", "article", "[role='main']"):
                try:
                    locator = page.locator(selector).first
                    candidate = locator.inner_text(timeout=2000).strip()
                    if len(candidate) >= 200:
                        text = candidate
                        break
                except Exception:
                    continue
            if not text:
                text = page.locator("body").inner_text(timeout=5000).strip()
            return {"url": page.url, "title": title, "text": text[:50000]}
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(422, f"Browser rendering failed: {exc}")
        finally:
            if context is not None:
                context.close()
