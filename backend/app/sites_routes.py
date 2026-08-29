"""Persistent, local-first website projects for the SMARAN.AI Sites screen."""

from __future__ import annotations

import html
import json
import re
import shutil
import subprocess
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from app.config import settings


router = APIRouter(prefix="/api/sites", tags=["sites"])
_lock = threading.RLock()
_root = Path(settings.DATA_DIR).resolve() / "sites"
_projects = _root / "projects"
_registry = _root / "registry.json"


class SiteCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    prompt: str = Field(min_length=3, max_length=20_000)


class SiteRefine(BaseModel):
    prompt: str = Field(min_length=3, max_length=20_000)


class SitePublish(BaseModel):
    netlify_site_id: str | None = Field(default=None, max_length=120)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _read_registry() -> list[dict]:
    with _lock:
        if not _registry.exists():
            return []
        try:
            data = json.loads(_registry.read_text(encoding="utf-8"))
            return data if isinstance(data, list) else []
        except (OSError, json.JSONDecodeError):
            return []


def _write_registry(items: list[dict]) -> None:
    with _lock:
        _root.mkdir(parents=True, exist_ok=True)
        temporary = _registry.with_suffix(".tmp")
        temporary.write_text(json.dumps(items, indent=2, ensure_ascii=False), encoding="utf-8")
        temporary.replace(_registry)


def _site_dir(site_id: str) -> Path:
    if not re.fullmatch(r"[a-f0-9]{12}", site_id):
        raise HTTPException(404, "Site not found")
    path = (_projects / site_id).resolve()
    if _projects.resolve() not in path.parents:
        raise HTTPException(400, "Invalid site path")
    return path


def _find(site_id: str) -> tuple[list[dict], int, dict]:
    items = _read_registry()
    for index, item in enumerate(items):
        if item.get("id") == site_id:
            return items, index, item
    raise HTTPException(404, "Site not found")


def _render(name: str, prompt: str, note: str = "") -> str:
    """The placeholder shown when no model could build the site.

    This is one fixed layout with the name and the brief dropped into it. It
    was previously the only thing Sites ever produced, presented as a
    generated website; it now appears only as a fallback and says so on the
    page, with the reason.
    """
    title = html.escape(name.strip())
    request = html.escape(prompt.strip())
    summary = request[:360] + ("…" if len(request) > 360 else "")
    reason = html.escape(note or "no model was available")
    banner = (
        f'<div class="notice"><strong>This is a placeholder, not a generated '
        f'site.</strong> Your brief has been saved, but {reason}, so this '
        f'stock layout is standing in. Start the local model and use Refine to '
        f'build the real page.</div>'
    )
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title><style>
:root{{--ink:#f7f7f8;--muted:#a1a1aa;--accent:#ef4444;--panel:rgba(24,24,27,.72)}}
*{{box-sizing:border-box}} body{{margin:0;min-height:100vh;color:var(--ink);font-family:Inter,ui-sans-serif,system-ui;background:radial-gradient(circle at 15% 5%,#3f1d25 0,transparent 34%),radial-gradient(circle at 90% 85%,#172554 0,transparent 34%),#09090b}}
nav{{display:flex;justify-content:space-between;align-items:center;padding:24px clamp(24px,7vw,96px);border-bottom:1px solid #27272a}} .brand{{font-weight:900;letter-spacing:.08em}} .dot{{color:var(--accent)}}
main{{max-width:1100px;margin:auto;padding:clamp(70px,13vw,150px) 24px}} .eyebrow{{color:#fb7185;font-weight:800;text-transform:uppercase;letter-spacing:.16em;font-size:12px}} h1{{max-width:880px;font-size:clamp(44px,8vw,92px);line-height:.95;margin:18px 0 26px;letter-spacing:-.055em}} .lead{{max-width:720px;color:var(--muted);font-size:clamp(17px,2vw,22px);line-height:1.7}} .cta{{display:inline-block;margin-top:34px;padding:14px 22px;border-radius:999px;background:#f4f4f5;color:#09090b;text-decoration:none;font-weight:800}}
.grid{{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:90px}} article{{padding:28px;border:1px solid #3f3f46;border-radius:22px;background:var(--panel);backdrop-filter:blur(12px)}} article span{{color:#fb7185;font-weight:900}} article h2{{margin:18px 0 10px;font-size:20px}} article p{{color:var(--muted);line-height:1.65;margin:0}} footer{{padding:32px;text-align:center;color:#71717a;border-top:1px solid #27272a}} @media(max-width:720px){{.grid{{grid-template-columns:1fr;margin-top:60px}}}}
.notice{{margin:0;padding:14px clamp(24px,7vw,96px);background:#422006;color:#fed7aa;border-bottom:1px solid #78350f;font-size:14px;line-height:1.6}}.notice strong{{color:#fdba74}}
</style></head><body>{banner}<nav><div class="brand">{title}<span class="dot">.</span></div><div>Built with SMARAN.AI</div></nav><main><p class="eyebrow">A new digital experience</p><h1>{title}</h1><p class="lead">{summary}</p><a class="cta" href="#explore">Explore the site</a><section class="grid" id="explore"><article><span>01</span><h2>Clear purpose</h2><p>The experience is structured around your brief, with a focused story and responsive layout.</p></article><article><span>02</span><h2>Built for every screen</h2><p>Typography, spacing and content adapt cleanly from desktop monitors to mobile devices.</p></article><article><span>03</span><h2>Ready to refine</h2><p>Return to SMARAN.AI Sites and describe the next change to create a new local version.</p></article></section></main><footer>{title} · SMARAN.AI Sites placeholder</footer></body></html>"""


BUILD_INSTRUCTIONS = (
    "You are building a complete, standalone website from a brief.\n"
    "Return ONE HTML document and nothing else - no explanation, no markdown "
    "fence. It must begin with <!doctype html>.\n"
    "Put all CSS in a <style> tag and any JavaScript in a <script> tag, so the "
    "file opens on its own with no build step and no network requests. Do not "
    "link to external stylesheets, fonts or images.\n"
    "Build what the brief actually asks for: its sections, its wording, its "
    "subject. Choose a palette and a layout that suit that subject rather than "
    "a default one. Make it responsive down to 360px wide.\n"
    "Use real, specific copy about the subject. Do not write placeholder text "
    "such as 'Lorem ipsum' or 'Feature one'.\n"
    "The <title> and the main heading must be the site name you are given. "
    "Never put your own model name anywhere in the page."
)


def _force_title(document: str, name: str) -> str:
    """Make the title the site's name.

    Small models get this wrong in a particular way: qwen2.5-coder:3b titled a
    tea shop "Qwen2.5 Coder:3b" and used the same string as the h1, while
    writing the menu and the address correctly. The name is something we know
    for certain, so it is set rather than hoped for. Only the title element
    and a heading that repeats it are touched; the rest is the model's.
    """
    safe = html.escape(name.strip())
    existing = re.search(r"<title[^>]*>(.*?)</title>", document, re.DOTALL | re.IGNORECASE)
    if not existing:
        return document
    wrong = existing.group(1).strip()
    if wrong.casefold() == name.strip().casefold():
        return document
    document = document[:existing.start(1)] + safe + document[existing.end(1):]
    # If the h1 was the same wrong string, it came from the same mistake.
    if wrong:
        document = re.sub(
            r"(<h1[^>]*>)\s*" + re.escape(wrong) + r"\s*(</h1>)",
            r"\g<1>" + safe.replace("\\", "\\\\") + r"\g<2>",
            document, count=1, flags=re.IGNORECASE)
    return document


def _extract_html(text: str) -> str | None:
    """The document out of a model reply, or None if there is not one.

    Models wrap HTML in fences even when told not to, so the fence is stripped
    rather than treated as failure. Anything that does not actually contain a
    document is rejected outright - returning half a reply as a website would
    be worse than saying nothing was generated.
    """
    if not text:
        return None
    fence = re.search(r"```(?:html)?\s*(.*?)```", text, re.DOTALL | re.IGNORECASE)
    if fence:
        text = fence.group(1)
    start = re.search(r"<!doctype html|<html\b", text, re.IGNORECASE)
    if not start:
        return None
    document = text[start.start():]
    end = document.lower().rfind("</html>")
    if end == -1:
        return None
    document = document[:end + 7].strip()
    # A document this short is a stub, not a site.
    return document if len(document) > 400 else None


def _generate_with_model(name: str, prompt: str, previous: str | None = None) -> tuple[str | None, str]:
    """Ask the local model for the site. Returns (html, how_it_was_made)."""
    import httpx

    base = settings.OLLAMA_URL.rstrip("/")
    try:
        tags = httpx.get(f"{base}/api/tags", timeout=3.0)
        if tags.status_code != 200:
            return None, "no local model server responded"
        # Embedding models are installed alongside chat models and cannot
        # generate text at all - asking nomic-embed-text for a web page gets
        # an error, not a page. Taking models[0] blindly picked exactly that
        # on this machine.
        installed = []
        for entry in (tags.json().get("models") or []):
            name = entry.get("name")
            if not name:
                continue
            family = ((entry.get("details") or {}).get("family") or "").lower()
            if "embed" in name.lower() or "bert" in family:
                continue
            installed.append(name)
    except Exception as exc:
        return None, f"local model server unreachable ({str(exc)[:60]})"

    if not installed:
        return None, ("the local model server is running but has no model that "
                      "can write text installed")

    brief = f"Site name: {name}\n\nBrief:\n{prompt}"
    if previous:
        brief += (
            "\n\nThis is a revision. Here is the current document; keep what "
            "still applies and change what the brief above asks for.\n\n"
            + previous[:40_000]
        )

    model = installed[0]
    try:
        # Generous timeout: a whole page is a long completion, and a cold
        # model has to load first.
        response = httpx.post(
            f"{base}/api/chat",
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": BUILD_INSTRUCTIONS},
                    {"role": "user", "content": brief},
                ],
                "stream": False,
                "think": False,
                "options": {"temperature": 0.6, "num_predict": 8192},
            },
            timeout=httpx.Timeout(600.0, connect=5.0),
        )
        if response.status_code != 200:
            return None, f"the model returned HTTP {response.status_code}"
        content = (response.json().get("message") or {}).get("content") or ""
    except Exception as exc:
        return None, f"the model call failed ({str(exc)[:80]})"

    document = _extract_html(content)
    if not document:
        return None, f"{model} replied, but not with a complete HTML document"
    return _force_title(document, name), f"generated by {model}"


def _write_version(site: dict, prompt: str) -> None:
    directory = _site_dir(site["id"])
    directory.mkdir(parents=True, exist_ok=True)
    version = int(site.get("version", 0)) + 1

    # Every site used to come out of _render, a single fixed template that
    # substituted the name and pasted the first 360 characters of the brief
    # into a paragraph. The brief was never read. That is why two sites with
    # completely different briefs looked identical, and why "Apply as Version
    # 2" produced the same page again. The screen offered to turn any idea
    # into a website and did not.
    previous = None
    if version > 1:
        existing = directory / "index.html"
        if existing.is_file():
            try:
                previous = existing.read_text(encoding="utf-8")
            except OSError:
                previous = None

    content, how = _generate_with_model(site["name"], prompt, previous)
    if content is None:
        # The template still exists, but only as a placeholder, and it now
        # says on the page itself that it is one. Handing back a stock layout
        # while calling it a generated website is the thing worth avoiding.
        content = _render(site["name"], prompt, note=how)

    (directory / "index.html").write_text(content, encoding="utf-8")
    versions = directory / "versions"
    versions.mkdir(exist_ok=True)
    (versions / f"v{version}.html").write_text(content, encoding="utf-8")
    site.update(prompt=prompt, version=version, updated_at=_now(), generated_by=how)


@router.get("")
def list_sites():
    return _read_registry()


@router.post("", status_code=201)
def create_site(body: SiteCreate):
    site = {"id": uuid.uuid4().hex[:12], "name": body.name.strip(), "prompt": body.prompt.strip(),
            "version": 0, "created_at": _now(), "updated_at": _now(), "published_url": None}
    _write_version(site, site["prompt"])
    items = _read_registry()
    items.insert(0, site)
    _write_registry(items)
    return site


@router.get("/{site_id}")
def get_site(site_id: str):
    return _find(site_id)[2]


@router.get("/{site_id}/preview")
def preview_site(site_id: str):
    _find(site_id)
    index = _site_dir(site_id) / "index.html"
    if not index.is_file():
        raise HTTPException(404, "Site preview is missing")
    return FileResponse(index, media_type="text/html", headers={"Cache-Control": "no-store"})


@router.post("/{site_id}/refine")
def refine_site(site_id: str, body: SiteRefine):
    items, index, site = _find(site_id)
    _write_version(site, body.prompt.strip())
    items[index] = site
    _write_registry(items)
    return site


@router.post("/{site_id}/publish")
def publish_site(site_id: str, body: SitePublish):
    items, index, site = _find(site_id)
    command = ["npx", "--yes", "netlify-cli@latest", "deploy", "--prod", "--dir", str(_site_dir(site_id))]
    if body.netlify_site_id:
        command.extend(["--site", body.netlify_site_id])
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=180, check=False, shell=False)
    except FileNotFoundError as exc:
        raise HTTPException(503, "Node.js/npm is required to publish to Netlify") from exc
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(504, "Netlify publishing timed out") from exc
    output = f"{result.stdout}\n{result.stderr}".strip()
    if result.returncode:
        raise HTTPException(502, output[-1200:] or "Netlify publishing failed")
    match = re.search(r"(?:Website URL|Unique Deploy URL|Production URL):\s*(https?://\S+)", output)
    if not match:
        raise HTTPException(502, "Netlify finished but did not return a deployment URL")
    site["published_url"] = match.group(1).rstrip()
    site["updated_at"] = _now()
    items[index] = site
    _write_registry(items)
    return site


@router.delete("/{site_id}", status_code=204)
def delete_site(site_id: str):
    items, index, _ = _find(site_id)
    directory = _site_dir(site_id)
    if directory.exists():
        shutil.rmtree(directory)
    del items[index]
    _write_registry(items)

