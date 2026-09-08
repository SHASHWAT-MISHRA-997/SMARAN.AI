"""Give the Director one project prompt and see what four specialists build.

Run it against whatever is configured:

    python tools/director_acceptance.py                  # local Ollama chat model
    python tools/director_acceptance.py --model llama3.2
    python tools/director_acceptance.py --simulated      # no model at all

`--simulated` is not a substitute for the other two. It drives the same state
machine with scripted replies, so it proves the scheduling, the scope
enforcement and the consolidation; it proves nothing whatsoever about whether
a real model writes a working page. Its output says so.

Everything is written to a disposable directory under .cache/audit and the
generated project is run afterwards, so "it worked" means the file it produced
actually loaded.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import shutil
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.orchestrator.routing import Candidate, Router          # noqa: E402
from app.orchestrator.run import Run, RunConfig, WorkspaceStore  # noqa: E402

WORK = ROOT / ".cache" / "audit" / "director-acceptance"

REQUEST = """\
Build a small static YouTube-style video gallery, using only plain HTML, CSS
and vanilla JavaScript - no frameworks, no build step, no network calls.

It needs:
- index.html, a page with a header and a grid of video cards
- styles.css, a dark theme; the grid must reflow to one column below 480px
- app.js, which reads a list of videos and renders the cards into the grid
- videos.js, exporting an array of at least six videos, each with a title,
  channel, view count and a thumbnail colour

Opening index.html in a browser must show the gallery with no console errors."""


def ollama_chat_models(url: str = "http://127.0.0.1:11434") -> list:
    """Chat models only. An embedding model cannot hold a conversation."""
    try:
        with urllib.request.urlopen(url.rstrip("/") + "/api/tags", timeout=5) as response:
            data = json.loads(response.read().decode("utf-8"))
    except Exception:
        return []
    usable = []
    for entry in data.get("models") or []:
        capabilities = (entry.get("capabilities") or [])
        if capabilities and "embedding" in capabilities and "completion" not in capabilities:
            continue
        family = ((entry.get("details") or {}).get("family") or "").lower()
        if "bert" in family:                      # nomic-embed-text and friends
            continue
        usable.append(entry.get("name"))
    return usable


# --- the scripted stand-in ---------------------------------------------------

PLAN = {"tasks": [
    {"id": "markup", "title": "Page markup", "role": "ui",
     "instruction": "Write index.html.", "scopes": ["index.html"],
     "acceptance": ["Links styles.css and app.js"]},
    {"id": "styles", "title": "Dark theme", "role": "ui",
     "instruction": "Write styles.css.", "scopes": ["styles.css"],
     "acceptance": ["One column below 480px"]},
    {"id": "data", "title": "Video data", "role": "backend",
     "instruction": "Write videos.js.", "scopes": ["videos.js"],
     "acceptance": ["At least six videos"]},
    {"id": "render", "title": "Rendering", "role": "feature",
     "instruction": "Write app.js.", "scopes": ["app.js"],
     "depends_on": ["data"], "acceptance": ["Renders every video"]},
    {"id": "review", "title": "Review", "role": "review",
     "instruction": "Check the result.", "scopes": [],
     "depends_on": ["markup", "styles", "data", "render"]},
]}

SCRIPTED = {
    "Write index.html.": ("index.html", """\
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Gallery</title>
<link rel="stylesheet" href="styles.css">
</head>
<body>
<header><h1>Gallery</h1></header>
<main><div id="grid" class="grid"></div></main>
<script src="videos.js"></script>
<script src="app.js"></script>
</body>
</html>"""),
    "Write styles.css.": ("styles.css", """\
:root { color-scheme: dark; }
body { margin: 0; background: #0f0f0f; color: #f1f1f1;
       font-family: system-ui, sans-serif; }
header { padding: 16px 24px; border-bottom: 1px solid #272727; }
.grid { display: grid; gap: 16px; padding: 24px;
        grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }
.card { background: #181818; border-radius: 12px; overflow: hidden; }
.thumb { aspect-ratio: 16 / 9; }
.meta { padding: 10px 12px; }
.title { font-size: 14px; margin: 0 0 4px; }
.sub { font-size: 12px; color: #aaa; margin: 0; }
@media (max-width: 480px) { .grid { grid-template-columns: 1fr; } }"""),
    "Write videos.js.": ("videos.js", """\
const VIDEOS = [
  { title: "Building a synth in C", channel: "Low Level", views: "412K", colour: "#e63946" },
  { title: "How rivers change course", channel: "Terrafirma", views: "1.2M", colour: "#457b9d" },
  { title: "Sourdough, properly", channel: "Kitchen Notes", views: "88K", colour: "#f4a261" },
  { title: "The Voyager tapes", channel: "Deep Field", views: "2.4M", colour: "#2a9d8f" },
  { title: "Repairing a 1970s radio", channel: "Bench Work", views: "310K", colour: "#8e7dbe" },
  { title: "Why bridges hum", channel: "Structures", views: "657K", colour: "#e9c46a" }
];"""),
    "Write app.js.": ("app.js", """\
(function () {
  var grid = document.getElementById("grid");
  if (!grid || typeof VIDEOS === "undefined") { return; }
  VIDEOS.forEach(function (video) {
    var card = document.createElement("article");
    card.className = "card";
    var thumb = document.createElement("div");
    thumb.className = "thumb";
    thumb.style.background = video.colour;
    var meta = document.createElement("div");
    meta.className = "meta";
    var title = document.createElement("p");
    title.className = "title";
    title.textContent = video.title;
    var sub = document.createElement("p");
    sub.className = "sub";
    sub.textContent = video.channel + " \\u00b7 " + video.views + " views";
    meta.appendChild(title); meta.appendChild(sub);
    card.appendChild(thumb); card.appendChild(meta);
    grid.appendChild(card);
  });
})();"""),
}

REVIEW = {"verdict": "pass",
          "summary": "A four-file static gallery: markup, dark theme, data and rendering.",
          "problems": [], "next_steps": []}


async def scripted(messages, candidate, timeout):
    from app.orchestrator import prompts

    system, user = messages[0]["content"], messages[1]["content"]
    if prompts.DECOMPOSE_SYSTEM[:40] in system:
        return json.dumps(PLAN)
    if "You are the reviewer" in system:
        return json.dumps(REVIEW)
    for marker, (path, body) in SCRIPTED.items():
        if marker in user:
            return '<file path="%s">\n%s\n</file>\n<notes>Wrote %s.</notes>' % (
                path, body, path)
    return "<notes>Nothing to do.</notes>"


# --- checking what was built -------------------------------------------------

def check_project(folder: Path) -> list:
    """Does the thing actually work? Answered by loading it, not by reading it."""
    results = []
    expected = ["index.html", "styles.css", "app.js", "videos.js"]
    for name in expected:
        results.append((name + " exists", (folder / name).is_file()))
    if not all(ok for _, ok in results):
        return results

    html = (folder / "index.html").read_text(encoding="utf-8")
    results.append(("index.html links styles.css", "styles.css" in html))
    results.append(("index.html loads app.js", "app.js" in html))
    results.append(("styles.css has a mobile breakpoint",
                    "480px" in (folder / "styles.css").read_text(encoding="utf-8")))

    # The real check: run the page's JavaScript and count the cards it made.
    node = shutil.which("node")
    if not node:
        results.append(("rendering (needs node, not installed)", None))
        return results

    # The two scripts are concatenated rather than eval'd separately, because
    # `const VIDEOS` inside an eval stays inside that eval. A browser loads
    # both as top-level scripts sharing one scope, and this reproduces that.
    shim = """\
var __cards = 0;
function __element() {
  return { className: '', textContent: '', style: {}, appendChild: function () {} };
}
var document = {
  getElementById: function () { return { appendChild: function () { __cards += 1; } }; },
  createElement: function () { return __element(); }
};
"""
    tail = """
if (typeof VIDEOS === 'undefined') { console.log('NO_DATA'); process.exit(1); }
console.log('CARDS=' + __cards + ' VIDEOS=' + VIDEOS.length);
"""
    harness = folder / "_check.js"
    harness.write_text(
        shim
        + (folder / "videos.js").read_text(encoding="utf-8") + "\n"
        + (folder / "app.js").read_text(encoding="utf-8") + "\n"
        + tail, encoding="utf-8")
    import subprocess
    outcome = subprocess.run([node, str(harness)], capture_output=True, text=True,
                             timeout=60, cwd=str(folder))
    text = (outcome.stdout + outcome.stderr).strip()
    ok = outcome.returncode == 0 and "CARDS=" in text
    cards = 0
    if ok:
        cards = int(text.split("CARDS=")[1].split()[0])
    results.append(("the page renders cards when run (%s)" % (text.splitlines()[-1] if text else "no output"),
                    ok and cards >= 6))
    harness.unlink(missing_ok=True)
    return results


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="")
    parser.add_argument("--simulated", action="store_true")
    parser.add_argument("--allow-paid", action="store_true")
    args = parser.parse_args()

    if WORK.exists():
        shutil.rmtree(WORK, ignore_errors=True)
    project = WORK / "gallery"
    project.mkdir(parents=True, exist_ok=True)

    simulated = args.simulated
    model = args.model
    if not simulated and not model:
        available = ollama_chat_models()
        if not available:
            print("No local chat model is available in Ollama.")
            print("Pull one (for example `ollama pull qwen2.5-coder:7b`) and")
            print("re-run, or use --simulated to exercise the state machine only.")
            return 2
        model = available[0]
        print("Using local model:", model)

    candidate = Candidate(provider="", model=model or "scripted-double",
                          capabilities=["code", "reasoning", "long_context"])
    call = scripted if simulated else None
    model_router = Router([candidate], call=call) if call else Router([candidate])

    run = Run(RunConfig(request=REQUEST, root=str(project), candidates=[candidate],
                        allow_paid=args.allow_paid, concurrency=2),
              store=WorkspaceStore(str(project)), router=model_router)

    label = "SIMULATED (scripted replies, no model was contacted)" if simulated \
        else "REAL local model: %s" % model
    print("=" * 72)
    print("Director acceptance -", label)
    print("=" * 72)

    result = await run.start()

    print("\nstate:", result["state"])
    if result["error"]:
        print("error:", result["error"])
    print("\ntasks:")
    for task in (result["graph"] or {}).get("tasks", []):
        print("  %-14s %-9s %-9s %s" % (task["role"], task["state"],
                                        (task["owner"] or "-"), task["title"]))
        if task["error"]:
            print("                 ! %s" % task["error"][:150])

    refused = [e for e in result["events"] if e["kind"] == "out-of-scope"]
    print("\nout-of-scope writes refused:", len(refused))
    for event in refused:
        print("  -", event["message"][:140])

    print("\nreview:", (result["review"] or {}).get("verdict"))
    for problem in (result["review"] or {}).get("problems", [])[:5]:
        print("  -", problem[:150])

    print("\nfiles written to", project)
    checks = check_project(project)
    print("\nacceptance checks:")
    passed = 0
    for name, ok in checks:
        mark = "SKIP" if ok is None else ("PASS" if ok else "FAIL")
        passed += 1 if ok else 0
        print("  [%s] %s" % (mark, name))

    hard = [ok for _, ok in checks if ok is not None]
    good = result["state"] == "done" and all(hard)
    print()
    print("RESULT:", "PASS" if good else "FAIL", "-", label)
    if simulated:
        print("This exercised the orchestration only. It is not evidence about")
        print("any model's output quality.")
    return 0 if good else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
