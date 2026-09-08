# Current verification — September 8–9, 2026

This records measured checks, not a guarantee of full product completeness.

## Final pass — everything re-run against the current source

Run after the last source change. Every number below was produced in this
pass, not carried forward.

### Automated checks

| Suite | Command | Result |
| --- | --- | --- |
| Backend + CLI | `python -m pytest backend/tests cli/tests -q` | **278 passed** |
| Frontend unit | `npm run test:unit` | **64 passed** |
| Frontend lint | `npx oxlint src tests` | no findings |
| VS Code extension | `npm test` | **22 passed, 1 skipped** (Windows symlink privilege) |

Started at 97 backend tests; 278 backend/CLI and 64 frontend now, with the
extension unchanged at 22.

### Real execution, not mocks

The packaged Windows executable was started from an isolated data directory
and everything below was run against it.

| Check | Result |
| --- | --- |
| `/api/test/ping` | `{"status":"ok","app":"SMARAN.AI","version":"2.10.34"}` |
| Six plugins executed for real | headroom, code-risk-scan, task-observer, provider-latency, meeting-notes-import, hyperframes — **all PASS** |
| Director `/roles`, `/models` | correct; `/models` lists `qwen2.5-coder:7b` and still excludes the embedding model |
| Paid-provider refusal over HTTP | refused, and the supplied test key **did not appear** in the error |

An earlier run of the plugin probe reported all six FAIL. That was
`WinError 10061`, connection refused — no server was running. Recorded because
a red result with no server behind it is not a regression, and reading it as
one would have been wrong.

### Director, second real-model run

`qwen2.5-coder:7b`, unscripted. Seven tasks across ui/feature/review, two
workers, no collisions, all completed. **The scope check fired again, on its
own:**

    Review and final check tried to write src/app.js, which it does not own. Discarded.

The reviewer — the role that owns no files precisely so it cannot rewrite what
it judges — attempted to write code, in both real runs, independently. That is
the failure the claims exist to stop.

The model's output again did not meet the brief: files under `src/` instead of
the four named at the project root, so all four acceptance checks failed and
the script reported `RESULT: FAIL`. New this time: **the model's own review
returned `pass` while the acceptance checks failed** — the reviewer approved
work that does not meet the request. That is a fact about a 7B model, not
about the orchestration, and it is the reason the run's `state` and its
`review.verdict` are reported separately rather than folded together.

### Secrets

| Artifact | Scanned | Findings |
| --- | --- | --- |
| Final APK | 287 entries | **0** |
| VSIX | 48 entries | **0** |
| Installer inputs (`dist/SMARAN.AI`) | 2,660 files | 1, and it is a false positive |
| Marketing site | 14 files | **0** |
| Analytics site | 24 files | 1, a variable *name* in documentation |

The installer hit was `torch-2.14.0.dist-info/RECORD` containing
`...LJsk-trKzjJE0tUMSA...` — the middle of a base64 SHA-256 in a pip manifest,
not a key.

### Artifact chain of custody

The APK is byte-identical in all three places it exists:

    on device : 7e1103cb6ef333743ab6eb874ec684e4a304c473d1998bc50e27823a3b210c1f
    built     : 7e1103cb6ef333743ab6eb874ec684e4a304c473d1998bc50e27823a3b210c1f
    on site   : 7e1103cb6ef333743ab6eb874ec684e4a304c473d1998bc50e27823a3b210c1f

Pulled from the phone with `adb pull` and hashed, not assumed.

| Artifact | Size | SHA-256 |
| --- | --- | --- |
| `app-release.apk` | 33,626,744 | `7e1103cb…` |
| `SMARAN.AI.exe` (Windows) | 70,115,686 | `f86de814…` |
| `SMARAN.AI-Setup.exe` | 280,312,115 | `f5b9e2b0…` |
| `SMARAN.AI` (Linux ELF) | 43,518,848 | `fafa0fef…` |
| `smaran-ai-codex.vsix` | 210,964 | `dc130efd…` |

Device: CPH2573, Android 16, serial `8f807260`, versionName 2.10.34,
versionCode 21034.

### Live sites

| Site | Check | Result |
| --- | --- | --- |
| `smaran-ai.netlify.app` | `/` | HTTP 200 |
| | APK range request | HTTP 206, ranges supported |
| `smaran-analytics.netlify.app` | `/` | HTTP 200 |
| | unauthenticated `POST /ingest` | **HTTP 401**, denied |


## Fixes in this pass

- Extension server-save and plugin-toggle failures no longer fabricate Running
  state or an invented MCP tool. Requests use authenticated transport and show
  backend errors. Failed deletes preserve the server entry.
- Custom MCP creation saves the real backend configuration. Custom skills are
  explicitly saved prompts; Use skill fills a reviewable chat draft. Removed
  the custom plugin option that only created an inert local card.
- MCP failed probes/calls discard broken sessions and retain the failure reason.
  Successful tool discovery survives subsequent status refreshes.
- Paperclip exposes commands found in the installed CLI's help, rather than an
  obsolete hardcoded list. CLI execution runs off the event loop and nonzero
  exit codes are failures. UTF-8 CLI output no longer crashes Windows reader
  threads. Headroom compression also runs off the event loop.
- Mobile CSS hooks were missing from rendered elements. Restored phone and
  landscape classification, hamburger navigation and layout hooks. Performance
  is not mounted on phones. Desktop workspace controls are hidden on phones.
- App rendering no longer waits on a potentially unreachable paired server.
- Android system-bar/cutout insets keep the header clear of the status bar.
- Energy Core uses male voice preferences, Indian English locale and natural
  Indian delivery instructions for live voice. Paired native phones now use
  the backend neural voice before native fallback. Native TTS preserves pitch,
  prefers matching locale/identified gender, reports unsupported languages and
  playback failures, and releases listeners on failure/stop.
- Telemetry watches client disconnects so abandoned sockets stop their send loop.

## Evidence

| Check | Observed result |
| --- | --- |
| Backend tests | 97 passed |
| Frontend voice/signal tests | 31 passed |
| Frontend lint | No warnings |
| Production frontend | Built successfully; build-plugin timing advisory remains |
| Phone controls, extension failure/draft workflows | Five targeted browser cases passed before the final small layout change |
| Subsequent seven-case browser run | Six passed; extension case exceeded overall 30-second budget after reaching the expected error state; targeted rerun recorded separately |
| VS Code tests | 22 passed, one existing Windows symlink privilege skip |
| Filesystem MCP | Started real published server, discovered 14 tools, wrote and read audit file |
| GitHub connector | Read public Experiential repository through live REST API |
| Six local plugin actions | Compression, code scan, observer, provider metrics, meeting-file scan and HyperFrames status returned results |
| Paperclip | Real agent --help execution completed |
| Google CLI | Real info --help returned 286 characters after UTF-8 fix |
| Indian male speech | Backend returned edge-neural MP3, 60,768 bytes |
| Android | Latest release built and installed on CPH2573; portrait, landscape and Speak inspected |

The phone's TTS API does not provide standardized gender metadata for every
installed voice. An opaque voice name cannot honestly establish male gender.
The identified Indian male neural voice is provided by the paired backend;
standalone native fallback quality depends on installed voice data. No claim
of human-indistinguishable speech or complete-sentence microphone acceptance
is made without an audible end-to-end test.

Evidence lives in `.cache/audit`: `mcp-live-result.json`,
`plugin-execution-current.json`, `energy-core-indian-male.mp3`,
`extension-current-tests.log`, `current-integration-ui-fixed.log`,
`final-mobile-browser.log`, `extensions-final-browser.log`, Android screenshots
and build logs. The current Windows build log is `windows-current-build.log`.

Full Genspark/AgentRouter parity, every external integration's authenticated
workflow, current Windows/Linux distribution acceptance, video generation,
and current live-site publication are not established by these checks.
Earlier release artifacts and deployment evidence do not verify newer source.

## Later pass — September 8, 2026

### agents-cli tool discovery is no longer hand-written

`get_tools()` ran `agents-cli --help`, discarded the output and returned a
list typed out in the source. The list had drifted: it advertised
`agents_cli_grade`, and the installed CLI answers `grade` with
`Error: No such command 'grade'`. It also offered `data-ingestion`, which the
CLI describes as `Removed:`. Commands, and their descriptions, now come from
parsing the `Commands:` section of the CLI's own help, cached after the first
read so request handling does not spawn a subprocess.

Two further defects fixed in the same file: `execute_tool`'s third branch was
unreachable, so `agents_cli_run` with an empty `command` fell through to the
second branch and silently ran `agents-cli run`, which starts an agent. And
the command name reached `argv[1]` unchecked — not shell-interpreted, but able
to smuggle in an option or a path — so it is now matched against
`[A-Za-z][\w-]*`.

| Check | Command | Observed result |
| --- | --- | --- |
| Backend suite | `python -m pytest backend/tests -q` | **113 passed** (97 before, 16 added) |
| New discovery tests | `python -m pytest backend/tests/test_agents_cli_discovery.py -q` | **16 passed** |
| Live CLI discovery | plugin against installed agents-cli v1.4.2 | **14 tools**, all real; `agents_cli_grade` absent |
| Live CLI execution | `agents_cli_info` via plugin `execute_tool` | exit 0, real help text returned |

The 14 discovered commands are exactly the 16 formerly hard-coded minus the
non-existent `grade` and the retired `data-ingestion`.

New tests: `backend/tests/test_agents_cli_discovery.py`, covering help parsing,
the retired-command filter, wrapped descriptions, an `Options:` section
following `Commands:`, non-ASCII and replacement-character CLI output on
Windows, refusal of option-shaped and path-shaped command names, and the
`agents_cli_run` fall-through.

### The video-package WinError 5, reproduced and then not reproduced

The staging design was already in place; what was missing was a real
demonstration. `tools/verify_video_install_lock.py` stages the identical
collision at a size that fits in a few seconds — protobuf is the package that
actually broke, and its `google/_upb/_message.pyd` is 728 KB rather than four
gigabytes.

| Step | Observed result |
| --- | --- |
| 1. Install protobuf into the live directory | `google\_upb\_message.pyd`, 728 KB |
| 2. Map that .pyd into the process, as a running app does | loaded |
| 3. Install over the live directory (the old behaviour) | pip exit 2, `PermissionError: [WinError 5] Access is denied: ...\google\_upb\_message.pyd` — **the owner's failure, reproduced** |
| 4. Install through the current code path, same DLL still mapped | status `done`, staged with completion marker, `Successfully installed protobuf-7.36.1` |
| 5. Promotion while the old copy is in use | deferred, `restart_required` true, live copy intact |

`downloaded_bytes` read 0 in step 4 because pip served the wheel from its
cache. That is the counter reporting what it actually received rather than
inventing a figure, and is the intended behaviour.

This proves the lock collision and the staging path that avoids it.

### Video install: cancellation, disk space, speed and ETA

Four things step 6 asks for were missing entirely: there was no way to cancel,
no disk-space check, no transfer speed or ETA, and no phase. All four are now
in `backend/app/video/install.py`.

**Cancellation stops the download, not a label.** `cancel()` terminates the
pip process and kills it if it ignores that; a flag alone would have let the
remaining gigabytes arrive anyway. A cancelled run is recorded as `cancelled`
rather than `failed`, its half-written staging directory is discarded, and
the completion marker is never written — so the next start cannot mistake it
for finished. Exposed as `POST /api/video/install/cancel`.

**Disk space is checked before anything downloads.** `REQUIRED_FREE_GB = 8`
covers roughly twice the download, because pip stages a wheel in its cache and
again in the target. Running out four gigabytes in leaves a half-written
directory and an error from inside pip that says nothing about disk space. A
drive that cannot be measured returns `None`, which means "could not tell" and
does not block the install.

**Speed and ETA are measured, and absent when they are not known.** Speed comes
from a 20-second rolling window of real byte counts, and is `None` rather than
zero before there is enough to measure — zero reads as a stalled download. The
ETA is offered only for the current file, whose size pip actually reported; an
ETA for the whole install would be measured against `APPROX_DOWNLOAD_GB`, one
machine's figure, and a wrong number of minutes is worse than none.

**Phase is reported as `packages`.** Model weights download separately and
later, and are deliberately not folded into these numbers.

#### Verified against a real network download

`tools/verify_video_install_cancel.py` runs a genuine pip download with
`PIP_NO_CACHE_DIR=1` so the bytes are actually fetched, watches the counters,
and cancels part way through.

    python tools/verify_video_install_cancel.py     ->  RESULT: PASS

| Check | Observed |
| --- | --- |
| Bytes really arrived | 13.1 MB before cancelling |
| Speed measured from the transfer | **6.17 MB/s** |
| ETA offered for a sized file | 4s remaining |
| Phase | `packages` |
| Cancel accepted | yes |
| Status after cancelling | `cancelled`, not `failed` |
| Error invented for a deliberate stop | none |
| Partial install marked complete | never |
| Anything already installed touched | nothing |
| pip process handle released | yes |

One correction worth recording: an earlier run of this check reported that
speed was never measured, and that was the check's fault, not the code's. It
cancelled on a byte count alone, and pip spends its first seconds resolving
before a byte moves — so it finished before the speed window had opened. A
direct probe showed the speed reading 4–5 MB/s and the ETA counting down 4, 3,
1 seconds. The check now waits for a speed to appear, bounded by its timeout,
so a speed that genuinely never arrives still fails it.

| Check | Command | Observed result |
| --- | --- | --- |
| Backend suite | `python -m pytest backend/tests -q` | **257 passed** (239 before, 18 added) |
| Progress and cancellation | `test_video_install_progress.py` | 18 passed |
| Real cancellation | `tools/verify_video_install_cancel.py` | PASS, all 10 checks |
| Lock collision | `tools/verify_video_install_lock.py` | PASS, unchanged |

#### The real multi-gigabyte install, and the two defects it found

Run at the owner's request against the real data directory by the real code
path: torch with CUDA, torchvision, diffusers, transformers, accelerate,
imageio, sentencepiece and protobuf.

    python tools/run_video_install.py

Log: `.cache/audit/video-install-real-first.log` (first run) and
`.cache/audit/video-install-real.log` (second). **4.76 GB installed** to
`data/video-packages`, staging promoted and removed.

Neither of the following could be seen at 45 MB. Both are why this was worth
running.

**A working install reported itself as failed.** The first run finished with
every file in place and said:

    status: failed
    error : The packages installed but could not be loaded: torchvision:
            operator torchvision::nms does not exist.

The install had worked; the verification had not. `_package_error()` imports
these packages to check them, but a module already in `sys.modules` stays
there however `sys.path` is arranged — so it measured the freshly installed
torchvision against the torch this process loaded at startup. This machine's
ambient torch/torchvision pairing is independently broken, which
`python -c "import torch, torchvision"` reproduces outside the installer
entirely. The installer now records which of these packages were already
imported before it starts, and when any were, reports `done` with
`restart_required` instead of running a check it knows cannot be trusted.

**A 4.76 GB install showed 0% from beginning to end.** Every wheel came from
pip's cache, and pip transfers nothing for those — it prints `Using cached`,
not `Downloading`, and emits no byte counter. `downloaded_bytes` stayed at
zero for the entire install. Those lines carry the size, so they are now
counted, into a separate `cached_bytes`: they move the bar because they are
progress, and they are never called a download because nothing was
transferred.

Re-run after both fixes, on the same machine:

| | Before | After |
| --- | --- | --- |
| Reported status | `failed` | **`done`**, `error: None` |
| Restart required | `False` | **`True`** — which is the truth |
| Progress reached | 0% throughout | **85%** |
| Installed size | 4.76 GB | 4.76 GB |

The second run also exercised the promotion path with the live directory in
use, and took it correctly: *"Installed. The running copy is still in use, so
restart SMARAN.AI to switch to it."*

| Check | Command | Observed result |
| --- | --- | --- |
| Backend suite | `python -m pytest backend/tests -q` | **264 passed** (257 before, 7 added) |
| Progress, cancellation, both defects | `test_video_install_progress.py` | 25 passed |
| Real install | `tools/run_video_install.py` | 4.76 GB, `done`, restart required |
| Real cancellation | `tools/verify_video_install_cancel.py` | PASS, all 10 checks |
| Lock collision | `tools/verify_video_install_lock.py` | PASS |

#### Still not proven

No **model weights** were downloaded — that is a separate, later fetch of 2–28
GB made on first generation, and no video has been generated. The install
above was served entirely from pip's cache, so a genuine multi-gigabyte
*network* transfer still has not been observed end to end; the largest real
transfer measured anywhere here is 13.1 MB at 6.17 MB/s. Disk exhaustion part
way through a real install was not injected either — only refused up front.
And the ambient torch/torchvision breakage on this machine is untouched: it is
outside these packages and outside this module's remit, but it means the
newly installed copy has not been shown to actually run.

### The multi-agent Director

Built as `backend/app/orchestrator/`, not `director`: `app.director` already
exists and turns a script into a video. The user-facing name is still the
Director; the module name had to differ.

It composes existing parts rather than duplicating them. Diff preview,
digest-based conflict detection and apply come from `app.workspace.core`;
provider calls go through `app.agent.models.complete`. The one change to
existing code is `ProviderError`, a `RuntimeError` subclass carrying the HTTP
status, because rate limiting and a bad key need opposite responses and the
previous code flattened both into a string. Every existing message is
unchanged and every existing caller still catches it.

| Piece | File |
| --- | --- |
| Task graph, scope claims, scheduling | `orchestrator/graph.py` |
| Provider routing, health, backoff, fallback | `orchestrator/routing.py` |
| Prompts and reply parsing | `orchestrator/prompts.py` |
| Run state machine, scope enforcement, rollback | `orchestrator/run.py` |
| HTTP surface, 8 endpoints under `/api/orchestrator` | `orchestrator/routes.py` |

Duplicate work is prevented in two places, not one. The scheduler never hands
out two tasks whose file claims can overlap, and a specialist's reply is
checked against its own claim before anything is written — a ui task that
returns the backend's file has that file discarded and the run records it.
Without the second check the claims would be advisory.

Three rules are enforced and tested: nothing paid is ever selected
automatically; a failure that another provider cannot survive (401, 400) rules
that provider out instead of being retried; and a task's files are applied
together, with the applied ones put back if a later one fails.

| Check | Command | Observed result |
| --- | --- | --- |
| Backend suite | `python -m pytest backend/tests -q` | **213 passed** (113 before, 100 added) |
| Task graph and scope claims | `test_orchestrator_graph.py` | 30 passed |
| Provider routing | `test_orchestrator_routing.py` | 20 passed |
| Prompt and reply parsing | `test_orchestrator_prompts.py` | 23 passed |
| Run state machine | `test_orchestrator_run.py` | 21 passed |
| HTTP surface | `test_orchestrator_routes.py` | 7 passed |
| Endpoints serve | `TestClient` against the whole app | `/roles` 200; run without a folder 400; paid-only run 400, key absent from the error |

Covered by those tests: decomposition (including fenced, prefaced and
malformed plans), duplicate prevention, out-of-scope writes, provider failure,
rate limit, timeout, empty replies, bounded retries, fallback with a stated
reason, cancellation before and during a run, rollback of a half-applied task,
removal of files a failed task created, and consolidation.

#### Acceptance run

`tools/director_acceptance.py` gives the Director one prompt — a static
YouTube-style gallery in plain HTML, CSS and JavaScript — in a disposable
directory, then runs what was produced.

    python tools/director_acceptance.py --simulated

Five tasks were planned across four roles, executed by two workers, with
`Rendering` correctly waiting on `Video data`. All four files were written,
and the generated page was executed under Node with a DOM stub: `CARDS=6
VIDEOS=6`. Every acceptance check passed.

**This run was simulated and proves only the orchestration.** No model was
contacted. Ollama is running on this machine but holds only
`nomic-embed-text`, an embedding model with capabilities `["embedding"]`,
which cannot hold a conversation; no other provider credential is configured.
The harness refuses to invent one — without `--simulated` it reports that no
chat model is available and exits 2. Nothing here is evidence about any real
model's output quality, and the script prints that in its own result line.

#### The panel

`frontend/src/components/DirectorPanel.jsx`, reached from the Project section
of the sidebar and registered in the Android back stack alongside the other
panels. It answers "which model is doing what, and why that one": every task
shows its owner by name, and a task that moved provider shows the reason it
moved. Writes that were refused for being outside a task's claim are shown in
the run rather than only logged.

Two defaults are deliberate. Changes are staged rather than written unless the
box is ticked, and metered providers are off with the reason stated next to
the control.

Accessibility: the dialog is `role="dialog" aria-modal`, focus moves to the
close button on open, Escape closes, every expander carries `aria-expanded`,
task state is given in words as well as colour, run state is announced through
`role="status" aria-live="polite"`, controls have visible focus rings, and the
one spinner is `motion-reduce:animate-none`.

`GET /api/orchestrator/models` exists so the panel cannot offer a model that
cannot work. On this machine Ollama holds only `nomic-embed-text`, and the
live server returns `{"local": [], ...}` with a note saying no local chat model
is installed — the embedding model is filtered out rather than listed as a
choice that would fail on the first task.

| Check | Command | Observed result |
| --- | --- | --- |
| Frontend lint | `npm run lint` | no findings |
| Frontend build | `npm run build` | built, v2.10.34 |
| Live endpoints | `curl` against `uvicorn app.main:app` | `/roles` and `/models` both correct |
| Embedding model excluded | `GET /api/orchestrator/models` before the pull | `local: []` plus the setup note, with `nomic-embed-text` filtered out |
| Chat model listed | same endpoint after the pull | `qwen2.5-coder:7b`, 7.6B; the embedding model still absent |
| Panel rendering | `frontend/tests/visual/director.html` on the bench | setup, working and finished states all render |

The panel was screenshotted on a bench rather than in the app because the app
is PIN-locked on this machine and the lock is decided by the backend, so a
fresh browser profile is locked too. No PIN was requested. The bench
(`director.html` + `director-harness.jsx`) follows the existing Energy Core
bench convention and is development-only — Vite builds `index.html` and
nothing else, so it does not ship.

Observed on the bench: each task row carries its owning model by name; two
tasks running at once showed two different models; a task that changed
provider showed `Moved to local/llama3.2:3b after local/qwen2.5-coder:7b was
rate limited`; refused out-of-scope writes, the review verdict and the staged
diffs all appeared; and tasks that never ran showed no owner.

#### Acceptance run against a real model

`qwen2.5-coder:7b` was pulled into Ollama (4.7 GB) and the same acceptance
script re-run against it, with no `--simulated`:

    python tools/director_acceptance.py

Log: `.cache/audit/director-real-model-run.log`.

**The orchestration worked.** The model produced a valid six-task plan across
the ui, feature and review roles; two workers ran them with no collision; all
six tasks completed; the reviewer returned a verdict. Most usefully, the scope
check fired against a real model rather than a fixture:

    Code review tried to write src/js/app.js, which it does not own. Discarded.

The reviewer — a role that owns no files precisely so it cannot rewrite the
work it is judging — attempted to write code. That is the exact failure the
claims exist to stop, and it was caught in an unscripted run.

**The model's output did not meet the brief, and the run says so.** The
request named four files at the project root; the model instead wrote eight
files under `src/`, as HTML fragments (`header.html`, `grid.html`,
`video-card.html`) with no `index.html` at all, so there is nothing to open.
The acceptance checks failed on all four expected files and the script
reported `RESULT: FAIL`. The reviewer independently reached the same
conclusion and returned `changes-needed`, naming the missing rendering logic.

The checks were left as they are. Relaxing them to accept whatever layout the
model chose would have turned a real miss into a pass.

So: the Director is proven against a real model; a 7B local model is not
proven sufficient for this brief. Those are separate claims and only the first
is established.

One thing worth knowing when reading a run: `state` reports whether the tasks
ran, not whether the result is good. This run ended `state: done` with
`review.verdict: changes-needed`. Anything consuming a run should read the
verdict, not only the state; the panel shows the verdict prominently for that
reason.

### Physical device pass — CPH2573, Android 16

Device `8f807260`, 1080x2376 at density 480, which is 792x360 CSS pixels in
landscape. Screenshots in `.cache/audit/device-step4/`. Each APK below was
built from current source, signed, installed with `adb install -r`, and
cold-started.

Final APK: 33,625,827 bytes, SHA-256
`fd608c9ad3d08a0de9289aba164bf66265e5ecc0e0969c2ab6db1300d3095cc0`,
versionName 2.10.34, installed 18:16. Credential scan of the release APK: 552
entries, **0 secret-shaped findings**. Cold start `TotalTime: 253ms`,
`LaunchState: COLD`. `RECORD_AUDIO` granted on the active profile.

WebView debugging is off in the release build — there is no
`webview_devtools_remote` socket and `uiautomator dump` returns one opaque
WebView node. That is correct for a signed release, and it means everything
below was verified from screenshots and real taps rather than from the DOM.

#### Defects found on the device and fixed

**The composer clipped its own placeholder in landscape.** "Ask from uploaded
files..." wrapped and lost its second line. Two causes: `autoSizeComposer`
ran only on input, so the pixel height measured in portrait was never
remeasured after rotation; and the one-row landscape toolbar squeezed the text
box below the width of its own placeholder. The composer now re-measures on
`resize`/`orientationchange`, wraps by measurement instead of at a 740px
breakpoint the phone missed by 52px, and the text box has a floor width.

**Amarya overlapped the conversation.** In landscape the companion was drawn
over a message bubble; in portrait a long reply scrolled underneath her, which
is where a code block's copy and download buttons sit. `DesktopPet` now
publishes its measured height as `--sm-pet-h` (the pattern `--sm-composer-h`
already used) and the message list reserves that much at its foot — zero when
the companion is switched off. In landscape she is hidden outright: with about
360px of height there is no position that is out of the way.

**RAG said ON while the request had already dropped it.** `/api/chat` sets
`rag_enabled = False` whenever `web_search` is on, but the two buttons were
independent, so both could read ON — the screen claimed the uploaded files
were being consulted while the answer came from the web, with nothing to
explain why. Separately, `ChatArea.jsx` sent
`rag_enabled: isRagEnabled && activeCollections.length > 0`, so with RAG on and
no collection picked in the sidebar the request went out as `rag_enabled:false`
and the backend answered from general knowledge. Both fixed: the flag is now
what the toggle says, the two modes are exclusive in the UI and reconciled on
load, and an empty `collections` means "no filter" rather than "no grounding" —
which the backend already handled.

The backend also now distinguishes "RAG is on and you have uploaded nothing"
from "your files do not cover this", and says which, in the user's language,
instead of one generic refusal.

**The assistant read punctuation aloud.** Bullets, table pipes, arrows, emoji
and long dashes were spoken, so replies sounded like a document being read.
The cleaner was duplicated in two places and both copies missed the same
things. Replaced with `frontend/src/utils/speakableText.js` and used by both
speech paths. It strips layout by naming symbol ranges, never by excluding
non-ASCII — this app answers in Devanagari and several other scripts, and a
cleaner that dropped "non-ASCII" would delete the reply.

**Amarya's arms moved like a marionette.** Three causes, all fixed in
`AvatarMMD.jsx`: a gesture change moved the arms to the new pose in a single
frame (now eased, frame-rate independent); one shared fixed-rate sine drove
both arms in exact mirror image (each arm now has its own rate and offset);
and the elbows bent in perfect step with the shoulders, making each arm one
rigid hinged piece (the forearm now trails).

| Check | Observed result |
| --- | --- |
| Backend suite | 213 passed |
| Frontend unit tests | **53 passed** (31 before, 22 added for speech text) |
| Frontend lint / build | clean |
| Portrait cold start | header clear of the status bar, model selector, composer, Hindi all correct |
| Landscape composer | placeholder on one line, toolbar wrapped, every control reachable |
| Landscape overlap | companion hidden, no overlap of the conversation |
| Portrait overlap | reply ends clear of the companion |
| RAG/Web exclusivity | drawer showed `Answer from my files: OFF` / `Search the live web: ON`; tapping RAG flipped it to `ON`/`OFF` and the placeholder followed |
| Voice screen | opens, Amarya front-facing with `FACING HELD` and `VIEW LOCKED`, arms at rest, visible close control, `Speech detected` live |

#### Voice screen pass

Final APK 33,626,223 bytes, SHA-256
`bb9612cfb3ac673ed0f30b62aa0c6cd7019834674425f4034fd9a83154f01b6e`.

**Three overlaps on the call screen, fixed.** The desktop companion was drawn
over the call — the screen already has a character on it — so she stands down
while `sm-voice-open` is set. The keyboard hint ("WASD rotate, Q/E, R reset")
was a list of keys on a device with none, and is hidden wherever the pointer is
a fingertip. And the "Type a message" box ran straight through the view
controls: raising the box was tried first and was the wrong shape of fix,
because it meant guessing the controls' height in advance and the guess was
88px against a stack measuring about 110. The controls move to the top of the
stage instead, where the background is empty, so nothing has to know how tall
anything else is.

**A hooks bug I introduced and fixed.** The caption's scroll effect was placed
after `if (!isOpen) return null`, so the hook ran on some renders and not
others and the app died with React error #310 on a real device. Moved above
the return and made to watch the values the caption is built from.

**The caption was unbounded.** It had no height limit and no scrolling, so a
long answer ran off the stage and was readable only as far as it happened to
fit. It is now a bounded subtitle that follows the newest line as she speaks
and can be scrolled back — and is left alone once the user scrolls up, because
yanking it back mid-sentence is worse than not following.

**Ending the call did not end the voice.** The red handset called
`stopLiveSession()` and `onClose()` but never `stopSpeaking()`, so she went on
talking to a screen that was no longer there. The X, the back gesture and every
other exit had the same hole. Now handled where all of them meet: speech stops
whenever the screen closes.

**A female character was speaking as a man.** English hides this — "I can help"
is the same either way — so it went unnoticed until Hindi, where the verb
carries the speaker's gender. Amarya was answering "मैं कर सकता हूँ", and
sometimes hedged into "सकता/सकती", which is nobody speaking. Nothing in the
system prompt had ever stated the assistant's gender. `ChatRequest` now carries
`assistant_gender`, and `_gender_and_tone_rule()` states the feminine or
masculine self-reference explicitly, forbids the slash form, and applies to
the live-call prompt as well. Amarya and Myra are women; the Energy Core is
the one given a man's voice. The same rule asks for a warm, friendly register
— the way friends talk — rather than a support desk.

The voice gender itself was read in three places with two different fallbacks
(one said male, two said female), so a character could be described one way and
voiced another. Now read once.

| Check | Observed result |
| --- | --- |
| Backend suite | 213 passed |
| Frontend unit tests | 53 passed |
| Lint / build | clean |
| Persona to gender | `myraa`/`myra` female, `core` male, unknown falls back female |
| Rule content | feminine form present, slash form forbidden, friendly tone asked for |
| Device | call screen renders with no overlaps; companion, keyboard hint and box collision all gone |

#### Languages other than English and Hindi

Reported as: other languages are neither understood nor answered in.

The cause was that language detection was gated behind the language picker.
`detect_language()` counts Unicode ranges locally — no network, no model — but
it only ran when `target_language != "en"`, and the picker defaults to English.
So a question typed in Gujarati with the picker untouched produced no
`LANGUAGE INSTRUCTION` at all, and the reply came back in English. Hindi hid
this because models follow the general "answer in the user's language" line
for Hindi unprompted; Gujarati, Tamil, Telugu, Kannada, Malayalam, Bengali and
Punjabi did not, and looked broken.

Detection now runs on every turn. The picker still wins when it has been set,
because that is someone asking for a language deliberately; otherwise the
script the question was written in decides. The instruction also names the
language rather than passing its code — "Respond entirely in gu" is not
something a model follows reliably, and `_language_name()` returns nothing at
all rather than letting a bare code reach the prompt.

Two limits are real and recorded rather than papered over. Devanagari is
shared, so a script check cannot tell Marathi from Hindi and reports `hi` for
both — only the picker can settle that. And romanised Hinglish
("mujhe batao") has no Devanagari to count, so it routes as English and is
handled by the general rule rather than an explicit instruction.

An earlier note in this document claimed Punjabi had no neural voice. That was
wrong: `NEURAL_VOICE_SUBSTITUTES = {"pa": "hi"}` is a deliberate, commented
substitution because the service publishes no Punjabi voice under any locale.
The note has been removed.

| Check | Observed result |
| --- | --- |
| Backend suite | **239 passed** (213 before, 26 added) |
| Script detection | Gujarati, Tamil, Telugu, Kannada, Malayalam, Bengali, Punjabi, Hindi each identified correctly |
| Naming | every language the picker offers resolves to a name, not a code |
| Unknown codes | produce no instruction rather than a bare code |
| Shared-script limits | Marathi reads as Hindi, romanised Hinglish reads as English — both asserted, so neither can regress silently |

New tests: `backend/tests/test_language_routing.py`.

Not verified: an actual conversation held in Gujarati or Tamil on the device.
The routing logic is unit-tested and the wiring reviewed, but no end-to-end
reply in one of these languages was obtained, so nothing here shows what the
configured model actually returns.

### Energy Core quality

Final APK 33,626,744 bytes, SHA-256
`7e1103cb6ef333743ab6eb874ec684e4a304c473d1998bc50e27823a3b210c1f`. Cold start
225ms.

**A fault could draw as a healthy core.** The tints lived inside the canvas as
a literal, looked up with `STATE_TINT[state] || STATE_TINT.idle`, so any state
the table did not list drew the healthy cyan idle core. `offline` was one of
them — and in fact no offline state existed anywhere in the app, so the one
indicator that would have shown it never could. The tints and labels now live
in `frontend/src/utils/coreStates.js`, where a state cannot exist in one and be
missing from the other, and a test asserts that no fault state is drawn in a
healthy colour.

`offline` was made real rather than decorative: the call screen watches
`navigator.onLine` and the `online`/`offline` events, the core resolves to
`offline` through `resolveCoreState()`, and the status line says
"Offline — no network connection, so nothing can be sent or answered."
Microphone conditions outrank it, because those are local, still true with no
network, and still the thing the user has to act on.

**The screen reader was told a picture existed and never what it showed.** The
canvas carried one fixed `aria-label`. It now reports the state, checked live
in the browser:

    offline    -> "SMARAN.AI energy core. Offline. Nothing can be reached right now."
    listening  -> "SMARAN.AI energy core. Listening."
    permission -> "SMARAN.AI energy core. Microphone permission is needed."
    error      -> "SMARAN.AI energy core. Something went wrong."

**The loop now stops when the app is backgrounded**, rather than relying on
the browser to throttle it. Measured on the bench by counting
`requestAnimationFrame` calls:

| Condition | Frames in 500ms |
| --- | --- |
| Visible | 73 |
| `document.hidden` | **0** |
| Visible again | 73 |

Reduced motion was already handled and was re-checked the same way: under
`prefers-reduced-motion: reduce` the core drew **0 animation frames**, and the
canvas was still painted and still correctly labelled — a still image in the
right colour, which is what the preference asks for.

| Check | Observed result |
| --- | --- |
| Frontend unit tests | **64 passed** (53 before, 11 added) |
| Lint / build | clean |
| Bench, all 13 states | each renders; offline is visibly dim and colourless beside idle's bright cyan |
| Labels | state-aware, verified live in the DOM |
| Backgrounded | loop stops and resumes, measured |
| Reduced motion | still frame, no animation, correct colour and label |

New tests: `frontend/tests/core-states.test.mjs` — every state has a tint and
its own label, no fault state shares a healthy colour, offline is dimmer than
muted, offline outranks the in-progress states but not the microphone ones,
and an unknown state resolves to something drawable rather than throwing.

The bench (`frontend/tests/visual/energy-core.html`) now takes its state list
from `CORE_STATES`, so a state added to the core cannot be missing from the
bench meant to show it.

Not done in this pass: the voice side of step 5 — the male Indian voice
direction for English/Hindi/Hinglish and speech queue/cancel/error handling —
beyond the persona gender work recorded above. No audible check was made, and
the Energy Core was verified on the desktop bench rather than by switching the
character to the core on the phone.

#### Found on the device and not fixed

- The landscape composer is about a third of the screen once the toolbar
  wraps, leaving roughly two lines of conversation visible. It is usable and
  scrolls, but it is tight.
- The `FRONT` view button on the call screen sits behind the character's hair
  and is hard to read.

#### Not verified, and why

Long dictation (30 seconds each of English, Hindi and Hinglish with natural
pauses), sentence-continuity on the physical microphone, and the audible
quality of Energy Core speech all require a person to speak into the phone and
listen to it. They were not performed and nothing here should be read as
evidence about them. The dictation UI reaches `Speech detected` with
`RECORD_AUDIO` granted, which shows the path is live — it does not show that a
30-second Hindi sentence survives intact, which was the original bug.

Amarya's arm motion was changed and the change builds and lints, but motion
quality cannot be judged from a screenshot. It has not been watched in
movement on the device.

The same applies to this pass's voice work. That speech now stops when the
call ends, that the caption follows a long answer, that Hindi comes out in
feminine forms, and that the tone reads as friendly were all verified as code
and as prompt content — the rule function was checked directly for the forms
it produces. None of them were verified by holding a conversation on the
phone and listening, which is the only thing that would settle them.

### Windows app, installer, CLI and Docker

Built from current source, installed, started, upgraded and uninstalled. Every
artifact below came from the same chain: source → `dist` → installer →
installed copy.

    python build_exe.py --output-root .cache/audit/windows-build --incremental
    ISCC /DSourceDir=<that dist> installer/SMARAN.AI.iss

| Artifact | Size | SHA-256 |
| --- | --- | --- |
| `SMARAN.AI.exe` (fresh dist) | 70,115,686 | `f86de8148afc150caad8e6442cc15b0cf0757e4feae913e80bf03d1602923482` |
| `SMARAN.AI-Setup.exe` | 280,312,115 | `f5b9e2b0440cf61ac959c2b65934291bf58aecaa5f46cb882ec6265839638232` |

The installed `SMARAN.AI.exe` is **byte-identical** to the built one, so the
installer ships what was built rather than something adjacent to it.

**The startup failure did not recur.** The packaged executable was run from an
isolated data directory with no development server and became ready on its
own: `runtime.json` written, `/api/test/ping` answering
`{"status":"ok","app":"SMARAN.AI","version":"2.10.34"}`, root `HTTP 200`.
First-run created `chroma`, `models`, `nltk_data`, `sqlite.db`, `uploads` and
`smaran.log`.

**Restart survives a stale runtime file.** The app was force-killed, which
leaves `runtime.json` naming a dead pid — the realistic crash case. The next
start bound the port again and answered normally.

**Startup diagnostics now say where to look.** The message was "The local
engine did not become ready in time, so the window was not opened." and
nothing else, which reports that something failed and not one fact about it.
It now carries the port and health URL waited on, how long it waited, the
process and pid, the log path and the data folder. The fields were checked to
resolve rather than merely to compile: an earlier draft of this referenced a
`settings` name that `desktop_app.py` does not import, which would have
crashed on the exact error path it exists to explain.

| Check | Observed |
| --- | --- |
| Install to isolated path | clean, silent |
| Installed exe vs built exe | identical |
| Start installed copy | ready, `/api/test/ping` ok, own data folder |
| Upgrade (install over existing) | exit 0, exe still identical |
| Uninstall | directory fully removed, no registry entry left |
| User data after uninstall | preserved, as it should be |

#### CLI, and a defect it had

Tested from the installed entry point, not the source.

| Case | Exit | Behaviour |
| --- | --- | --- |
| `--help` | 0 | usage and subcommands |
| `--version` | 0 | `smaran 2.10.34` |
| invalid subcommand | 2 | names the valid choices |
| `status`, app stopped | 1 | says it is not running and names `SMARAN_URL` |
| `status`, app running | 0 | reports the live address |
| `models` | 0 | 63 in catalogue, engine state stated honestly |
| `ask`, no working key | 1 | names each model that refused and what to do |

**Hindi output to a file crashed.** `smaran ask ... > answer.txt` died with
`UnicodeEncodeError: 'charmap' codec can't encode characters`, exit 1, **zero
bytes written**. On Windows a redirected stream takes the legacy code page —
cp1252 here — which has no Devanagari, and it looked fine on the console,
which is why it survived. `_print_any_language()` now reconfigures stdout and
stderr to UTF-8 with `errors="replace"`, so a terminal that cannot draw a
glyph prints a placeholder instead of losing the answer. Verified across
Hindi, Gujarati, Tamil, Kannada and Bengali, plus a subprocess writing to a
real file. New tests: `cli/tests/test_output_encoding.py`, including one that
asserts the original failure is real so the guard cannot quietly stop guarding.

An end-to-end Hindi answer *through* the CLI was not obtained: the configured
OpenRouter key is rejected — "rejected the key (wrong, expired, or lacking
access)" — which is the key flagged for rotation at the start of this work.
That is a credential state, not a code path.

#### Docker

Diagnosed, not touched. Nothing was reset and no Docker data was deleted.

`com.docker.service` is **stopped** and the engine pipe does not exist:
`open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file
specified`. The `dockerInference` file named in the crash report is one of
several stale sockets in `AppData\Local\Docker\run\` whose metadata cannot
even be read — a leftover, not the cause. The cause is in
`com.docker.backend.exe.log`:

    starting WSL engine: bootstrapping main distribution: running wslexec:
    An error occurred while running the command. DockerDesktop/Wsl/ExecError

Docker Desktop 4.83.0 cannot bootstrap its `docker-desktop` WSL distribution.
WSL itself is healthy — four distributions registered, Ubuntu-24.04 default,
version 2 — so this is Docker's own distribution, not WSL.

**SMARAN does not need Docker, and this was shown rather than assumed:** the
packaged executable served `/health` while `com.docker.service` was stopped.

A safe next step for the owner, not taken here because it affects their other
distributions: start Docker Desktop and watch whether the bootstrap succeeds;
if it fails again, unregistering only the `docker-desktop` distribution makes
Docker recreate it. `wsl --shutdown` would stop Ubuntu and Kali too.

| Check | Command | Observed result |
| --- | --- | --- |
| Backend + CLI suites | `pytest backend/tests cli/tests -q` | **278 passed** |
| CLI suite | `pytest cli/tests -q` | 14 passed (4 added) |

Not done: startup with the network disabled. Disabling this machine's
networking to test it was not a reasonable thing to do unasked, so offline
startup remains unverified.

### Linux artifact

Built and run in **WSL Ubuntu 24.04.4 LTS**, Python 3.12.3, PyInstaller
6.22.2, pip 24.0. Not cross-compiled: the binary was produced by Linux tools
and started on Linux.

`sudo` needs a password on this machine, so nothing was installed system-wide.
Dependencies went to a private directory via `pip3 install --target`, which
needs no privileges — and that choice caused both failures below.

| Artifact | Size | SHA-256 |
| --- | --- | --- |
| `SMARAN.AI` (ELF) | 43,518,848 | `fafa0fefeb07effb2624ef5c1886cc027452bf50ede0c864bedb2615be9c4221` |
| dist total | 1.2 GB | |

`file` reports **ELF 64-bit LSB executable, x86-64, dynamically linked**, and
the highest symbol version required is **GLIBC_2.14**, so it does not demand a
recent distribution.

**Two build failures, both from mixing a private dependency directory with
Ubuntu's own packages.**

The first was `ValueError: numpy.dtype size changed, may indicate binary
incompatibility. Expected 96 from C header, got 88 from PyObject` — the system
`scipy` 1.11.4 was compiled against numpy 1.x while the private directory
supplied numpy 2.5.3, which shadowed it.

The second only appeared at runtime. The binary built, started, and died with
`pyo3_runtime.PanicException: Python API call failed` from
`cryptography/exceptions.py`. PyInstaller had bundled **Ubuntu's system
`cryptography` 41.0.7**, whose Rust extension is built for the system
interpreter and panics inside a frozen one. Installing cryptography 50.0.1
into the private directory so it shadows the system copy fixed it.

Both are worth recording because neither is visible until the thing is run:
the first stopped the build, the second produced a binary that looked fine.

**The rebuilt binary starts and serves.**

| Check | Observed |
| --- | --- |
| Startup | engine ready in ~18s |
| `runtime.json` | `{"port": 3003, ...}` written |
| `/api/test/ping` | `{"status":"ok","app":"SMARAN.AI","version":"2.10.34"}` |
| `/health` | same |
| First-run data | `chroma`, `nltk_data`, `sqlite.db`, `uploads`, `smaran.log` |
| Plugins | nine started; `google-agents-cli` registered and not started, correctly |
| Executable bit | absent on NTFS, present when read through WSL; a `.tar.gz` would carry it |

**A real gap in the Linux artifact:** speech transcription does not work.
The log says `Speech model 'base' warm-up skipped: No module named
'tokenizers.tokenizers'`. The `tokenizers` package is present (0.23.2) but
PyInstaller did not bundle its compiled Rust submodule. The Windows build does
not have this problem — faster-whisper ran there. The likely fix is a hidden
import, which is not recorded here as done because it was not rebuilt and
re-run, and an unverified fix is worth less than a stated gap.

**Not produced:** `.AppImage`, `.deb` and `.rpm`. `build_linux.sh` makes all
four formats, but AppImage needs `appimagetool` and `patchelf`, which need
`sudo` to install. Only the frozen directory was built and tested, so no
claim is made about the packaged formats, their installation, or their
uninstallation. `check_packages.sh` was not run.

### VS Code extension

| Check | Observed |
| --- | --- |
| `npm test` | **22 passed, 1 skipped, 0 failed** |
| VSIX | `smaran-ai-codex` 2.20.1, 210,964 bytes, 50 files |
| VSIX SHA-256 | `dc130efddcc5f05800d2dc778bde2ee59740f480e6b9ca932423f82590ffb3e4` |

The one skip is named exactly, as asked: **"search refuses a file symlink
outside the workspace"**, skipped with the reason *"Windows file symlink
privilege unavailable"*. It is a workspace-escape security test, and creating
a file symlink on Windows requires Developer Mode or an elevated process.
It is not hidden, not reclassified, and was not forced to pass by changing
this machine's settings.

**Not done:** the end-to-end workflow. Installing the VSIX into a disposable
VS Code profile, opening a throwaway project, driving the extension to write a
feature from a prompt, and checking diffs, cancellation, provider failure and
the generated project's tests — none of that was performed. Only the unit
tests and the packaging step were.

### Marketing site — PUBLISHED

Live: `https://smaran-ai.netlify.app`. Published in two deploys, each verified
against production after the fact.

| Deploy | id | What it shipped |
| --- | --- | --- |
| First | `6aa055bc1b6f64675ae19308` | Refreshed APK and cache-busted assets |
| Second | `6aa05a5fe223ccbd6c9bb7cd` | Download-button and warning-panel fixes |

Rollback: either previous deploy can be restored from
`https://app.netlify.com/projects/smaran-ai/deploys`. The deploy immediately
before this work is the one to return to if the APK needs reverting.

**Production checks after publishing:** APK `Content-Length: 33626744` and
SHA-256 `7e1103cb6ef333743ab6eb874ec684e4a304c473d1998bc50e27823a3b210c1f`,
downloaded in full from the live site and identical to the built APK. Security
headers unchanged and correct.

#### Three faults found on the live site and fixed

**A download button that downloaded nothing.** "Download the VSIX" pointed at
`releases/latest/download/smaran-ai-codex.vsix` and answered **404** — no
release has ever carried that asset, and the comment beside the link claimed
it was "never behind". Removed, along with the paragraph explaining how to
install a file that could not be obtained. Every other download link was
checked and all seven resolve.

**The Linux CLI button was styled as secondary.** The card offers "Windows &
Linux" and one binary per platform, but Windows got `btn-primary` and Linux
`btn-ghost`, so the Linux download read as an afterthought. Both are primary
now.

**Seven amber panels, most of which were not warnings.** One style carried
both real warnings and ordinary instructions — how to `chmod` an AppImage,
where the `.deb` lives, what the CLI is — so everything shouted equally and
the one that mattered read as decoration. A neutral `.dl-info` style now
carries instructions; amber is left for the two things that can actually stop
an install: the unsigned Windows binary and the Linux browser-window
difference. A second panel restating the signing warning inside the same card
was deleted. Seven became three.

Verified on production: 0 broken VSIX anchors, 3 amber warnings, 4 neutral
panels, both CLI buttons `btn-primary`.

#### Known, not fixed

The GitHub release is **v2.10.33** while the current build is 2.10.34, so
every download link on the site serves artifacts one version behind the source
this document describes — the APK excepted, which is served from the site
itself and is current. Refreshing the release means uploading roughly 1.9 GB
of installers, which was not done.

### Earlier: preview verification before publishing

Preview: `https://6aa051684401205298d4ba7d--smaran-ai.netlify.app`
Deploy id `6aa051684401205298d4ba7d`. **Nothing was published to production.**

**The site was carrying a stale APK.** `website/downloads/SMARAN-AI.apk` was
`723c8abaf113cb37ad8e4afc72c685c2f3bee89903f638fe7ee49205edeafdd4`, built at
16:26, from before every mobile fix in this pass. Deploying without noticing
would have shipped an APK older than the source it was advertised against.
Replaced with the current build and `python stamp.py` re-run for cache busting.

**A deploy from the wrong directory would have gone to the wrong site.** The
repository root is linked to Netlify project `zippy-naiad-216088`; only
`website/` is linked to `smaran-ai` (`dc3a6e25-c361-48c9-b532-ab0b3b2c8443`).
Deploys must be run from `website/`.

| Check | Observed |
| --- | --- |
| APK served by preview | downloaded in full, 33,626,744 bytes, SHA-256 `7e1103cb…` — **identical to the built APK** |
| `Content-Type` | `application/vnd.android.package-archive` |
| `Content-Length` / `Accept-Ranges` | correct size advertised; ranges supported |
| Page render | loads, hero and content correct |
| Mobile 375×812 | readable; horizontal overflow **2px**, from the decorative background canvas |
| HTTP → HTTPS | 301 redirect |
| Security headers | HSTS `max-age=31536000; includeSubDomains; preload`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, restrictive `Permissions-Policy` |
| Secret scan, 14 text files | **0 findings** |

The download needed resuming across several attempts. The server advertised
the correct length and supports ranges, so that is this machine's connection
rather than the site — but it is recorded because a visitor on a poor link
will hit the same thing.

The one console error on the preview is **correct behaviour**: analytics
refuses the preview origin because it only allows
`https://smaran-ai.netlify.app`. Origin locking works; it will succeed from
production.

### Analytics site

Audited, not deployed.

| Check | Observed |
| --- | --- |
| Unauthenticated `POST /ingest` | **HTTP 401** — denied |
| `GET /api` unauthenticated | HTTP 404 |
| Secret scan, 24 files | one hit, and it is the *variable name* `ANALYTICS_INGEST_KEY_SHA256` in `DEPLOY.md`, not a value |
| Served dashboard HTML | no secret-shaped strings |
| Design | stores a SHA-256 verifier rather than the key, and fails closed on missing configuration |

Not done: authorized ingestion with a disposable event, dashboard error
handling, and the analytics preview deploy. No analytics credential is
configured locally, and one was not requested.

## What is NOT verified

Listed here so it is not necessary to read the whole document to find the
gaps. Nothing below should be treated as working.

**Needs a person, not a machine.** Long dictation — 30 seconds each of
English, Hindi and Hinglish with natural pauses — sentence continuity on the
physical microphone, and the audible quality of any speech. The original
reported bug was sentences being cut off, and that can only be settled by
speaking into the phone and listening. Amarya's arm motion was changed and
builds cleanly, but motion quality cannot be judged from a screenshot.

**Blocked on a credential.** No end-to-end Hindi answer through the CLI: the
configured OpenRouter key is rejected. No cloud-provider Director run.

**Not performed.** The VS Code extension's end-to-end workflow — installing
the VSIX into a disposable profile and driving it to write a feature. Offline
startup of the Windows app, which would have meant disabling this machine's
network. Authorized analytics ingestion with a disposable event, and the
analytics dashboard's error handling.

**Known gaps in artifacts.** The Linux build cannot transcribe speech —
`No module named 'tokenizers.tokenizers'`, a PyInstaller bundling gap that
Windows does not have. No `.AppImage`, `.deb` or `.rpm` was produced; those
need `appimagetool` and `patchelf`, which need `sudo`. The GitHub release is
`v2.10.33` while the source is 2.10.34, so every download link except the APK
serves artifacts one version behind.

**Not proven at scale.** No model-weight download (2–28 GB) and no video
generated. The 4.76 GB package install came entirely from pip's cache, so a
genuine multi-gigabyte network transfer has still not been observed; the
largest real transfer measured anywhere here is 13.1 MB at 6.17 MB/s.

**Environment, outside this work.** Docker Desktop cannot bootstrap its WSL
distribution; SMARAN does not need it and was shown running with the Docker
service stopped. This machine's ambient torch/torchvision pairing is broken
independently of the installer.

### Not attempted in this pass

Physical-device mobile acceptance, Energy Core visual/performance acceptance,
the Windows installer rebuild, Linux artifacts, the VSIX workflow, and both
Netlify production deployments were not started. No claim is made about any
of them.
