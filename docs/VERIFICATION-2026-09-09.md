# Independent verification — 9 September 2026

This is an in-progress audit of Claude's `9cf605e` handoff. It does not certify release completion.

## Independently reproduced baseline

- Backend/CLI: `python -m pytest backend/tests cli/tests -q -p no:cacheprovider`: 278 passed, 12 dependency warnings.
- Frontend unit tests: 64 passed.
- VS Code extension: 22 passed, 1 skipped (Windows file-symlink privilege unavailable).
- APK, Windows executable, installer, and VSIX hashes matched the handoff at audit start.
- Android serial 8f807260 is authorized, app version 2.10.34 present. Microphone permission is granted in the active installed profile; the package also has another profile permission record.
- Six live runtime plugin probes passed against the isolated backend on port 3003: headroom, code-risk-scan, task-observer, provider-latency, meeting-notes-import, hyperframes.

## Corrections and fixes

### Linux speech: foreign optional packages shadow the valid bundle

The Linux artifact **does contain** `tokenizers/tokenizers.abi3.so`. `ldd` resolves its dependencies and Python 3.12 imports that bundled package successfully.

Adding the shared project's `data/video-packages` ahead of the bundle reproduces exactly `ModuleNotFoundError: No module named 'tokenizers.tokenizers'`: this directory contains Windows wheels, including `tokenizers.pyd`. The reported missing-hidden-import diagnosis was therefore not supported by the artifact.

`backend/app/video/install.py` now checks installed wheel tags against the active OS/Python before adding an optional package directory to `sys.path`. Incompatible files remain untouched; status exposes the incompatibility. Two regression tests cover refusal without path mutation and acceptance of compatible/native and universal wheels.

Validation: 35 installer safety/progress tests passed. Full backend/CLI suite after this fix: **280 passed, 12 dependency warnings**. Linux read-only activation proof: `tools/verify_video_package_platform.py` rejected foreign wheels and successfully imported tokenizer 0.23.2 from the frozen bundle's `_internal` directory. This is not yet proof of speech transcription through the rebuilt executable.

### Avatar controls

The view-control HUD now has an explicit higher stacking layer and opaque background; FRONT/SIDE/BACK buttons have improved text contrast, focus outline and minimum height. Frontend production build and Android release build succeeded. APK installation returned Success. Visual acceptance of the new HUD remains to be completed.

### Empty conversation history polling

`App.jsx` treated a successful empty session list as a failure and retried every two seconds indefinitely. Successful empty responses now settle. Retry timers are cleared on unmount, and late session responses preserve the current selected session through functional state updates. The new browser regression test passed against the production build, observing more than two former retry intervals.

## Browser evidence and limits

- Both `mobile-reply-voice.spec.js` tests passed: readable fenced explanations and Speak/back handling. These use mocked API responses.
- Initial phone-controls run: three failures because the required backend was absent, not evidence of a layout regression.
- Re-run with a real isolated backend: one passed, two timed out while loading/locating the composer. These remain unresolved; they are not counted as passes.
- Production-artifact follow-up: added opt-in `SMARAN_TEST_PREVIEW=1` to the existing Playwright config to serve the built assets. All **6 tests passed in 19.1s** (empty history, two reply/Speak tests, and portrait/landscape at 390x844, 792x360, 667x375). The development-server loading timeouts remain recorded above; assertions and timeouts were not weakened.
- Test runner also reports conflicting FORCE_COLOR/NO_COLOR environment settings. Gradle reports deprecated dependency/plugin features; neither warning has been silently suppressed.

## Physical speech

Observed the actual phone voice screen showing "Speech detected". That proves a UI/native recognition state, not full sentence transcription or audible voice quality. Requested the owner's 30-second spoken test; the reply "KARO" supplied authorization but no spoken-test result. No claim is made that the original sentence-cutting issue is resolved on the microphone.

After reinstalling the HUD update, opened Dictate on the physical phone and observed the button switch to "Stop dictating". Asked the owner to speak while it is active. Sentence preservation still requires the resulting transcript.

## Release state

### Multilingual speech follow-up

The owner physically tested and reported incorrect words in Dictate and Speak, including languages other than Hindi. This is a confirmed failed accuracy acceptance test. Logs showed the forced `en-GB` on-device recognizer. Both UI callers now use Indian English for the English hint; Android uses the configured system recognizer and requests API 34+ automatic language detection/switching without a two-language allowlist. Backend recordings now request `auto` rather than the reply-language setting. Removed raw transcript logging from Android. These changes do not guarantee recognition quality on every service/language pack.

Frontend lint/build passed; voice unit suite 64 passed. Latest multilingual Android release build succeeded in 14s and `adb install -r` returned **Success**. Physical multilingual accuracy must be re-tested on this newly installed APK; earlier results were from the old recognizer.

Windows rebuild completed successfully but predates the last multilingual frontend changes. Linux PyInstaller completed; final output copy and startup validation are not yet certified. Production sites have not received these changes.

Linux rebuild launched with the compatibility fix; final frozen startup check pending. Subsequent frontend polling fix requires rebuilding frontend-dependent artifacts again. No production deployment or GitHub release update has been made in this audit. Earlier handoff gaps (real video generation, all connector operations, VSIX end-to-end workflow, Linux package formats, analytics authorization, release refresh) remain unverified.

Logs: `.cache/audit/sep9-*.log`. Preserve prior user screenshots, Android data, and all unrelated worktree changes.

---

## Later pass — mobile HUD, caption layout, and voice commands

Continues from `9cf605e` with the Sep 9 working-tree changes preserved. Every
number below was produced in this pass.

### Suites

| Suite | Result |
| --- | --- |
| `pytest backend/tests cli/tests -q` | **308 passed** (280 → 308) |
| Frontend unit | **68 passed** (64 → 68) |
| Frontend lint | no findings |
| Playwright (voice layout, empty session, mobile reply) | **8 passed** |
| Playwright with a live backend on :3003 | 11 passed, including the three `phone-controls` cases |

`phone-controls.spec.js` has **zero** `page.route` mocks and needs a real
backend. Run without one it fails with `ECONNREFUSED 127.0.0.1:3003`, which is
a missing dependency and not a regression — it passed as soon as the packaged
executable was serving.

### 1. All view controls removed from the phone

`VIEW LOCKED`/`VIEW FREE`, `EYES TRACKING`, `FACING HELD`/`FACING FREE`,
`FRONT`, `¾`, `SIDE`, `BACK` and the keyboard hint are gone in **both**
orientations — `html.sm-phone-device .mmd-hud { display: none; }`, keyed on the
existing phone-device detection rather than a viewport width, because a phone
held sideways reports 792px and is not a desktop.

Removed, not made transparent, so they take no space and catch no taps. This
does **not** release the camera or her facing: `viewLocked` and `holdFacing`
both default to `true` in `AvatarMMD`, so with no way to toggle them she stays
locked and front-facing. Confirmed on the device — she is centred and facing
front with no controls drawn.

The previous behaviour, which moved this HUD to the top of the stage on
mobile, is superseded and its rule deleted.

### 2. The answer no longer sits on the character

The stage was four absolutely-positioned layers sharing one rectangle: the
character at `inset-0`, the caption at `top-[18%]`, the message box at a fixed
offset from the bottom, and a status pill. Any long answer was drawn across
her face, and the only remedy available was to guess a pixel offset — which
then broke at a different height.

It is a flex column now: `.voice-stage` → `.voice-main` (`.voice-figure` +
`.voice-caption`) → `.voice-footer`. Separate boxes, so they cannot overlap at
any size. The caption takes at most half the stage and scrolls inside itself;
with nothing said it has no content, no height, and the figure gets the room
back. Sideways `.voice-main` becomes a row, so the character sits beside the
words rather than under them.

New tests: `frontend/tests/visual/voice-stage-layout.spec.js` — five cases
asserting the controls are absent in both orientations, that the figure and
caption rectangles do not overlap, that a long answer scrolls, and that an
empty caption returns its space.

**A defect this introduced, found on the device and fixed.** In landscape the
character collapsed to a sliver about 30px tall. The header and call bar keep
full-size padding, and the same status sentence was printed three times — in
the header, on the stage, and again above the call buttons — leaving the stage
almost nothing. The duplicates are hidden sideways, the padding is tightened,
and the in-stage message box is hidden in landscape, where the keyboard covers
the screen anyway and the same box is one rotation away. Re-verified on the
device: she is visible, front-facing and centred.

### 3. Voice commands to the desktop — three defects

Audited before changing anything; the implementation is real, with
`open_url`/`open_application` actions, a catalog, and Hinglish verbs already
present. Three faults were found by exercising it:

**A YouTube search claimed to be playing.** `detect_browser_command` opened
`youtube.com/results?search_query=…` and said `Playing {query} on YouTube.`
Nothing plays until a video is chosen. It now says it is opening search
results and returns `action: "search"`.

**A refusal executed the command it refused.** `"I do not want you to open
chrome"` opened Chrome, and `"I do not want you to open youtube"` opened
YouTube. The desktop guard was anchored to the start of the line, so it caught
`"do not open chrome"` and missed the same words mid-sentence. A shared
`is_being_discussed()` now looks at the whole line and is used by both paths.

**Hindi word order did not work at all.** Every application pattern required
the verb first, so `"open chrome"` worked and **`"chrome kholo"` did nothing** —
the exact example in the request. Verb-last patterns were added for
`kholo`/`khol do`/`chalu karo`/`start karo`/`open karo`.

**A regression this caused, caught by the suite.** The first refusal list
included `stop`, `cancel` and `band karo`, which broke
`"awaz band karo"` — a real mute command. Those are legitimate verbs here and
were removed from the list; only words that can only be a refusal remain.

New tests: `backend/tests/test_voice_commands.py`, 26 cases covering Hinglish
verb-last order, English order, refusals in both languages, quoted and
question forms, and the honesty of what each command reports doing.

### 4. Sentences cut at natural pauses

The lifecycle was read before anything was changed. It is sound: the watchdog
fires after silence, `waitForFinalTranscript` then waits up to 900 ms more for
the recogniser to commit, and `pollFinalTranscript` correctly returns
`resumed` — aborting the turn — when speech comes back. That path is already
unit tested.

The fault is the size of the window, not the logic. 850 ms plus the grace is
about 1.75 s, which is right for "yes" and wrong for a dictated paragraph,
whose sentences have longer gaps. The fix is not a bigger constant applied
everywhere: `silenceWindowMs()` scales the window with how much has already
been said — 850 ms for a short reply, easing to 2.2 s once the length makes it
plainly dictation. Four unit tests cover the ends, the monotonic middle, and
bad input.

**This is not evidence that recognition is accurate.** It changes when a turn
is considered finished. Whether the recogniser hears the right words is a
separate question that needs a person speaking and comparing.

### Artifacts

| Artifact | Size | SHA-256 |
| --- | --- | --- |
| `app-release.apk` (installed on 8f807260) | 33,627,132 | `3f32b37bce9c4cf2700dadbee495b442549fe0bd9ab39ec7c960bf497aac65a5` |

Device: CPH2573, Android 16, serial `8f807260`, **user profile 0**, app data
preserved (no uninstall). Cold start 301 ms.

### Not verified in this pass

- **Speech accuracy.** Dictate and Speak hearing the wrong words is the
  owner's headline complaint and is untouched by anything here. It needs known
  reference utterances spoken aloud and compared, in Hindi, Indian English and
  Hinglish, over 30–60 seconds with natural pauses. No such test was run and
  no claim is made.
- Voice-to-desktop commands were verified at the detector level, not by
  speaking into the phone and watching Calculator open.
- Windows and Linux artifacts predate this pass's frontend changes and were
  not rebuilt.
- The `.deb` (292 MB) and `.AppImage` (352 MB) at
  `.cache/audit/linux-sep9/dist/linux/` completed, but were built before these
  changes and have not been installed or started.

### VS Code extension — real host, real model

**A correction first.** An earlier attempt in this pass reported the host smoke
test as passing with six checks. That was wrong: `code.cmd --extensionTestsPath`
returns immediately without entering test mode unless
`--extensionDevelopmentPath` is also given, so nothing ran and the result file
being read was **two days old**, from 7 September. Both runs were re-done
properly once the timestamps were checked.

| Run | Result |
| --- | --- |
| Host smoke, correct workspace | **passed: true**, 6 checks, result written this pass |
| Host smoke, wrong workspace | failed on the workspace-path assertion — the harness requires `<audit>/vscode-workspace` |
| Live coding scenario, `gemini-2.5-flash` | failed: the model is retired for new users; the extension reported the provider's own message |
| Live coding scenario, `gemini-3.6-flash` | **failed at HTTP 429, free-tier quota exhausted mid-run** |

Smoke checks, all in a real extension host against the packaged 2.20.1 VSIX:
packaged extension discovered, activated, agent commands registered, agent
webview resolved with scripts and CSP, packaged edit and undo operating in an
isolated workspace, and the packaged `ws` loading.

The live scenario got far enough to be informative. The agent opened its real
panel, made real model calls, proposed real diffs (`stats.cjs: +48 -0`,
`stats.test.cjs: +55 -0`) and wrote both files. **The code it produced is
correct**, checked here independently of the model's own tests:

    summarize([])        -> {count:0, sum:0, min:null, max:null, mean:null}
    summarize([-2,0,5])  -> {count:3, sum:3, min:-2, max:5, mean:1}
    summarize(null)      -> TypeError
    summarize([NaN])     -> TypeError

It then stopped on `gemini refused the request (HTTP 429). You exceeded your
current quota`. `README.md` was never written and `node --test` was never run,
so the scenario correctly reported `passed: false` rather than accepting
incomplete work — which is the property that mattered most about it.

Provider keys were probed without printing them: **gemini works**; `nvidia`
returns 410, `anthropic` 401, `openrouter` 401 "User not found". The
OpenRouter key remains rejected.

### Windows executable rebuilt on current source

    python build_exe.py --output-root .cache/audit/windows-build --incremental
    python tools/verify_frozen_startup.py --name sep9b-windows <exe>

| Artifact | Size | SHA-256 |
| --- | --- | --- |
| `SMARAN.AI.exe` | 70,118,298 | `49aa57a98202aeec2383dce0d7187d4aaa4101f27e3b17292cfe78f4f238c196` |

Startup on the rebuilt binary: `passed: true`, health
`{"status":"ok","version":"2.10.34"}`, frontend served, **ready in 18.88 s**.

### Still outstanding after this pass

- **Speech accuracy** — untouched and unverifiable without the owner speaking.
- The Linux frozen dist and both packages (`.deb` 292 MB, `.AppImage` 352 MB)
  still predate this pass's backend voice-command changes, which are compiled
  into the PyInstaller archive rather than loose files. A frontend-only refresh
  would ship stale Python, so they need a full rebuild before they mean
  anything.
- Neither Linux package has been installed or started.
- The Windows installer has not been rebuilt from this new dist.
- The live coding scenario needs a provider with remaining quota to finish.
- The full plugin/skill/connector/MCP inventory is still the six built-in
  probes plus endpoint checks, not an exhaustive per-feature classification.

### Linux packages rebuilt from current source, and started

The previous packages were built before this pass's backend voice-command
changes. Those are compiled into the PyInstaller archive rather than shipped as
loose files, so refreshing only `_internal/frontend_dist` would have shipped
stale Python. `build_linux.sh` re-freezes **only when the binary is missing**,
so the stale frozen directory was removed first to force a genuine rebuild.
Both deletion targets were confirmed inside the project build directory before
running, and `paths.sh` refuses a build root outside the project.

Build host: **Ubuntu 24.04.4 LTS** (WSL), Python 3.12.3, PyInstaller 6.22.2.
No `sudo` was used at any point.

| Artifact | Size | SHA-256 (first 16) |
| --- | --- | --- |
| `smaran-ai_2.10.34_amd64.deb` | 306,066,486 | `7b5bfb9dda517d0a…` |
| `SMARAN.AI-2.10.34-x86_64.AppImage` | 369,089,016 | `2762931ad543ded0…` |
| `smaran-ai-2.10.34-linux-x86_64.tar.gz` | 399,259,515 | `3ccbe06644f2c810…` |

The `.deb` grew from 305,936,182 to 306,066,486, which is how the rebuild is
known to have changed content rather than repackaged the old tree.

**Package metadata and permissions.** `Package: smaran-ai`, `Version: 2.10.34`,
`Architecture: amd64`, `Depends: libc6 (>= 2.28)`, browsers under `Recommends`
rather than `Depends` — correct, since the Linux build opens a browser window
instead of bundling a webview. Payload is **root/root**, directories 0755,
executables 0755, and **nothing is group- or world-writable**: the 777 that
Windows-mounted WSL paths report, which had made `dpkg-deb` reject the control
directory, does not survive into the package.

**Both packages start.** Extracted and launched with an isolated `DATA_DIR`:

| Package | Ready | Health | Frontend |
| --- | --- | --- | --- |
| `.deb` (extracted, 982 MB installed) | 12 s | `{"status":"ok","version":"2.10.34"}` | HTTP 200 |
| `.AppImage` (`--appimage-extract-and-run`, no FUSE) | 12 s | same | HTTP 200 |

The AppImage bound port 56305 rather than 3003, which was already in use — the
port fallback works rather than failing on a busy default.

**The bundled offline pronunciation resources are confirmed in a shipped
artifact**, which no previous build had. Both runs logged
`Copied averaged_perceptron_tagger_eng from …/_internal/nltk_data` followed by
`Offline voice resources ready`, resolving from inside the package rather than
from an ambient location.

**On portability.** The binary is ELF 64-bit x86-64 and the highest symbol
version it requires is **GLIBC_2.14**, so it does not demand a recent
distribution. That is not the same as "runs on every Linux distribution": it
was built and started on Ubuntu 24.04 only, `dpkg -i` was never run as root,
and no other distribution was tested.

**What was not done.** A real `dpkg -i` install as root, an uninstall
(`dpkg -r`) leaving-nothing-behind check, and any test on a distribution other
than the build host. `rpmbuild` is unavailable, so no `.rpm` exists.

### Windows installer rebuilt — and blocked from installing by Smart App Control

    ISCC /DSourceDir=<fresh dist> /O<out> installer/SMARAN.AI.iss

| Artifact | Size | SHA-256 |
| --- | --- | --- |
| `SMARAN.AI-Setup.exe` | 280,316,613 | `b0ba0f0b1c127bb9675840d6bae6b05c5a2bb1382ef0ded7c59e3fb17200b92c` |

Compiled successfully in 181 s from 3,218 files, taking its payload from
`.cache/audit/windows-build/dist/SMARAN.AI` — the dist rebuilt in this pass,
whose executable is `49aa57a9…` and which was independently confirmed to start
(`passed: true`, health `2.10.34`, frontend served, ready in 18.88 s).

**It could not be installed on this machine.** Running it returns:

    'SMARAN.AI-Setup.exe' was blocked by your organization's Device Guard policy.

The machine's state, read but not changed:

    CodeIntegrityPolicyEnforcementStatus:            2  (enforced)
    UsermodeCodeIntegrityPolicyEnforcementStatus:    2  (enforced)
    SmartAppControl VerifiedAndReputablePolicyState: 1  (on, enforcing)

Smart App Control is enforcing, and it refuses unsigned binaries that have no
reputation. There is no "run anyway" for it — which is exactly what the
download page's remaining amber warning says. **Nothing was disabled or
excluded to get around this**, because that would be changing the owner's
security configuration to make a test pass, and it would also invalidate the
test: the point is whether a user's machine accepts this installer, and this
one does not.

An earlier installer in the previous pass did install on this machine, so the
policy verdict is not fixed for all builds; Smart App Control evaluates each
new unsigned file.

**What this leaves unverified for the installer specifically:** installation,
the installed-file-versus-built-file byte comparison, first start from the
installed location, upgrade over an existing install, and uninstall. Those were
all exercised in the previous pass against the previous installer, and none of
them has been repeated against this one. The remedy is code signing, or the
owner permitting this specific binary on their machine.

### Plugin, skill, connector and MCP inventory — every one executed

Previously six built-in probes had been run. This is all thirteen, each with a
real operation carried out against the packaged backend, not a status read.

`GET /api/plugins` reports **13 plugins, all `runtime_status: active`**.

| Plugin | Capabilities | Operation executed | Result |
| --- | --- | --- | --- |
| code-risk-scan | 4 | `strix_scan_code` | real |
| github-reader | 2 | `github_get_repo_info` | real — live GitHub API, returned the repository |
| google-agents-cli | **14** | `agents_cli_info --help` | real — CLI help returned |
| headroom | 2 | `headroom_compress` | real |
| hyperframes | 3 | `hyperframes_status` | real |
| long-term-memory | 3 | `claudemem_recall` | real — searched 0, matched 0, honest empty result |
| meeting-notes-import | 2 | `meetily_scan` | real |
| paperclip | 69 | `paperclip_doctor` | real — CLI output, including an upstream update notice |
| provider-latency | 3 | `omniroute_get_metrics` | real |
| task-observer | 2 | `observer_review_session` | real |
| text-reverse | 5 | `reverse_string` | real — `SMARAN` → `NARAMS` |
| ui-ux-review | 3 | `ui_ux_audit_checklist` | real |
| web-page-reader | 2 | `firecrawl_scrape_url` | real — see below |

The `google-agents-cli` count of 14 is the earlier discovery fix holding up
through HTTP: the list comes from the CLI's own `--help`, and the invented
`grade` tool is absent.

**The one that needed checking.** `web-page-reader` reported success, and a
connector reporting success is exactly the shape a fabricated result takes. It
is real: scraping `https://example.com` returned `title: "Example Domain"`,
142 characters of the actual page text, and the genuine outbound link to
`iana.org/domains/example`. An initial reading of this as empty was a mistake
in the probe — it looked at `content` when the field is `markdown_content`.

**Request shapes differ by kind**, which is worth recording because getting it
wrong returns `422` and looks like a broken plugin: tools take
`{tool_name, arguments}`, skills `{skill_name, context}`, connectors
`{operation, parameters}`.

**MCP and custom items.** `GET /api/mcp/servers` returns an empty list with the
note *"A saved server is not a connected one. Use
/api/mcp/servers/{name}/probe to actually start it and read its tools."* — the
correct truthful state rather than a saved configuration presented as a live
connection. `GET /api/plugins/custom/all` returns `[]`. On this isolated data
directory there is nothing claiming to be Active that is not.

**Not covered:** credentialed integrations were not exercised, because none is
configured on this isolated profile — so their "needs setup" presentation is
still unverified. Connector behaviour under a revoked or wrong credential, and
localhost SSRF / path traversal / argument injection for custom MCP entries,
were also not tested.

### Custom MCP: what a user-supplied server is allowed to do

A custom MCP entry is a string the user provides, and `connect()` turns it into
one of two things: an `http(s)` target becomes a request this app makes, and
anything else becomes a program it runs. Both were examined.

**No shell is involved.** `StdioSession.start()` uses `shlex.split` followed by
`asyncio.create_subprocess_exec`. Shell punctuation therefore cannot start a
second command: in `npx server; calc.exe` the program launched is `npx` and
`; calc.exe` is argv. Asserted for `;`, `&&`, `|`, `$( )`, backticks and `&`,
plus a source guard that fails if `create_subprocess_shell` or `shell=True`
ever appears in that file.

**Names are keys, not paths.** `_store_path()` writes one
`mcp_servers.json` inside `DATA_DIR`; the server name is a dictionary key.
Adding a server called `../../evil` was verified to leave the data directory
containing only that one file, and to create nothing beside it.

**Saving is not connecting**, and the endpoint says so in its own response.
A disabled server is refused before anything runs, and an unknown name is
refused by name.

New tests: `backend/tests/test_mcp_security.py`, 17 cases.

**One thing to be clear about rather than reassuring.** The MCP routes carry no
authentication dependency, unlike most of the API. That matters less than it
first appears: the server binds to loopback, and CORS is restricted by regex to
local origins plus one named Chrome extension — not `*` — so a JSON `POST` from
a hostile page is refused at preflight, and a DNS-rebinding origin does not
match the pattern either. What remains is that **any local process running as
the user can add and probe a server**, which is arbitrary command execution by
a process that could already run commands. It is not privilege escalation, and
it is not remotely reachable. It is still an inconsistency with the rest of the
API, and worth an auth dependency; that change was not made here because it
touches how the desktop UI talks to its own backend and deserves its own pass.

### Offline startup — and a false alarm of my own

Tested by pointing the process at a dead proxy rather than disabling the
machine's networking, so the owner's connectivity was never touched.

**First attempt reported that the app fails to start offline.** It did not.
`_wait_until_ready()` checks health with `urllib.request.urlopen`, which honours
`HTTP_PROXY`, and I had additionally set `NO_PROXY=""` — so the app's own
loopback health check was routed through the dead proxy and could never
succeed. The 180-second timeout that followed was my test breaking, not the
product.

Re-run with `NO_PROXY=127.0.0.1,localhost,::1`, so external calls still fail
while loopback is exempt:

| Check | Result |
| --- | --- |
| `runtime.json` | written, port 3003 |
| `/api/test/ping` | `{"status":"ok","app":"SMARAN.AI","version":"2.10.34"}` |
| Frontend | HTTP 200 |

**The app starts with no outbound network.** The log shows it doing so
gracefully: plugins loaded, bundled offline voice resources ready from
`_internal/nltk_data`, and both speech models' warm-up *skipped* with the real
reason (`ConnectError: [WinError 10061]`) rather than failing the start. The
warm-up runs on daemon threads and does not block serving, which is why a
missing network delays nothing.

Worth recording: the failure message in the first attempt carried the port, the
health URL, the wait, the pid, the log path and the data folder — the
diagnostics added earlier in this work, doing their job on a real failure.

### External references

| Reference | Outcome |
| --- | --- |
| `genspark.ai` and `genspark.ai/skills` | **HTTP 403** — not readable. No capability list obtained, and none is guessed here. |
| `agentrouter.org` | Reachable but the page carries only a title; the content is client-rendered. **No features, licence or pricing could be read.** |
| `github.com/experientiallabs/experiential` | Read successfully. **Apache-2.0.** |

Only the third could actually be assessed, so it is the only one mapped.

**experiential** describes itself as an open source gateway and router for
agent workflows: one OpenAI-compatible API over hosted, BYOK and local models;
control over which users and agents may use which models and how much they may
spend; OpenTelemetry traces used to build a router optimised for quality, speed
and cost. Installable with `pip install experiential`, with a managed service
alongside it.

Against what SMARAN has today:

| Capability | SMARAN |
| --- | --- |
| One interface over hosted and local models | **Implemented** — `agent/models.py` covers OpenAI-compatible, Gemini, Anthropic and Ollama |
| Capability-based routing between models | **Implemented** — `orchestrator/routing.py`, ordered per role |
| Health, backoff, rate-limit handling, fallback with a stated reason | **Implemented**, unit tested |
| Never selecting a paid provider on the user's behalf | **Implemented** — stricter than the reference, which is about budgets rather than consent |
| Per-user and per-agent spend limits | **Not implemented** |
| An OpenAI-compatible gateway endpoint others can point at | **Not implemented** — routing is internal |
| OpenTelemetry traces, and routers learned from them | **Not implemented** |

The licence permits building the missing pieces or self-hosting the project.
Nothing here claims parity: three of seven are absent, and the two sites that
could not be read may describe capabilities not represented above at all.

---

## The .rpm, and a world-writable payload that the .deb did not have

The rpm built on the first attempt and was the right size, which is exactly why
it needed opening. `rpm -qlvp` on it showed `drwxrwxrwx` and `-rwxrwxrwx` for
every entry — including `/opt/smaran-ai/SMARAN.AI`, the application binary. A
world-writable binary in `/opt` is a local privilege-escalation primitive: any
user on the machine can overwrite it and wait for the next person to run it.

The `.deb`, built from the same tree in the same script run, was correct. That
difference is the whole diagnosis. The tree lives under `/mnt/c`, which WSL
mounts 9p/drvfs **without `metadata`**, so `chmod` does not persist and every
path reads back as 0777 no matter what was asked for. `build_deb.sh` runs
inside `fakeroot`, which remembers the modes it was asked for and hands them to
`dpkg-deb` in the same session. `rpmbuild` ran outside any such session and
read the real filesystem.

Two fixes were rejected before the right one. A `%defattr(0644,root,root,0755)`
in the spec would have set the modes, and would also have stripped the execute
bit from bundled helpers such as ffmpeg. Exporting a shell function and calling
`fakeroot bash -c rpm_build_cmd` did not carry the function through — it failed
with `rpm_build_cmd: command not found`, and because of `set -e` that run
produced neither an rpm nor an AppImage.

The fix is `packaging/linux/build_rpm.sh`, invoked under fakeroot exactly the
way `build_deb.sh` already was. Same normalisation pass, same session, so rpm
gets the view dpkg-deb had.

### Read back from the rebuilt package

```
entries: 1759
world-writable: 0
owner/group: root root  (1759 of 1759)

drwxr-xr-x  root root         0  /opt/smaran-ai
-rwxr-xr-x  root root  41823080  /opt/smaran-ai/SMARAN.AI
-rwxr-xr-x  root root        47  /usr/bin/smaran-ai
-rwxr-xr-x  root root       186  /usr/share/applications/smaran-ai.desktop

distinct modes present: 1443 -rwxr-xr-x, 316 drwxr-xr-x
```

One honest note on that last line: every regular file is 755 rather than data
files landing on 644. `chmod a=rX,u+w` keeps the execute bit on files that
already had one, and on drvfs every file already reads as executable, so `X`
matched all of them. Nothing is world-writable and nothing is group-writable,
which is the property that mattered; the `.deb` has the same shape. Building on
a filesystem that carries Unix metadata would give the tighter split.

### Extracted and started

`rpm2archive` (cpio is not installed here; the payload is the same either way)
into `~/rpmextract`, which is ext4, so the modes persist and can be read back:

```
-rwxr-xr-x  /home/shash/rpmextract/opt/smaran-ai/SMARAN.AI
-rwxr-xr-x  /home/shash/rpmextract/usr/bin/smaran-ai
drwxr-xr-x  /home/shash/rpmextract/opt/smaran-ai
```

Then run directly:

```
port 3003, ready after ~18s
ping: {"status":"ok","app":"SMARAN.AI","version":"2.10.34"}
frontend: 200
index title: <title>SMARAN.AI - Autonomous AI Coding Assistant</title>
Plugins running: code-risk-scan, github-reader, headroom, hyperframes,
  long-term-memory, meeting-notes-import, paperclip, provider-latency,
  task-observer, text-reverse, ui-ux-review, web-page-reader
```

`xdg-open` fails in this WSL because no browser is installed there. That is the
environment, not the package — the app falls through its browser list and keeps
serving, which is the behaviour `_open_browser_window` is written for.

### All four artifacts, from one build

```
sha256                                                            bytes      file
55389cf3ce87fec9c87e132d18ffb08789fd390916979a0c47879a29becb4117  369089016  SMARAN.AI-2.10.34-x86_64.AppImage
1026edfa00d59999ce2d3a7ea6cc123053e271d467d7a64a296ec798b1db78fd  397331333  smaran-ai-2.10.34-1.x86_64.rpm
d78bf98e12a0dd473848df22a4fe32a1375dc02b8834c5574819e48e22b3fd7c  399259516  smaran-ai-2.10.34-linux-x86_64.tar.gz
3838fdaaefef8e4e3cb806ec8a2f76e24288acf9ed43b92fd80d5727a710672c  306066488  smaran-ai_2.10.34_amd64.deb
```

`rpmbuild` 4.18.2 was installed without root, by `apt-get download` and
`dpkg -x` into `~/rpmlocal/root` with `PATH`, `LD_LIBRARY_PATH` and
`RPM_CONFIGDIR` pointed at it. No password was needed and none was requested.

### Not verified

The rpm was extracted and run, not installed with `rpm -i` — that needs root on
a machine with an rpm database, and this is Ubuntu. Install scriptlets
(`%post`, `update-desktop-database`) and dependency resolution on a real
Fedora, RHEL or openSUSE machine remain untested.

---

## Linux CLI built, and 2.10.34 published

### The CLI

`smaran-linux-x86_64` was the one asset in v2.10.33 with no current build
anywhere on disk. Frozen with PyInstaller 6.22.2 from `~/smaran-build/libs`,
the same environment the Linux desktop app was frozen in, so the two come out
of one toolchain.

```
ELF 64-bit LSB executable, x86-64, dynamically linked, for GNU/Linux 3.2.0, stripped
8180600 bytes
```

Run with `PYTHONPATH` unset, the way someone who downloads the file has it:

```
smaran 2.10.34
usage: smaran [-h] [--version] {status,models,ask,chat} ...
```

Then against the app that came out of the rpm:

```
$ smaran status
Running at http://127.0.0.1:3003
  account    device_local_default_user

$ smaran models
63 in the catalogue, 0 downloaded
engine: unavailable
```

and with nothing running, it explains itself rather than throwing a traceback:

```
[!] SMARAN.AI does not appear to be running.
Start the desktop app, then try again.
If it is running on an unusual address, set SMARAN_URL.
exit: 1
```

No analytics endpoint or key was set, so `analytics_config` was generated empty
and the binary reports nothing. A search of the binary for either string finds
zero matches.

### Two staleness checks that changed what shipped

Timestamps alone were not enough to tell which artifact was current, because
drvfs does not preserve them through a copy. Both dists were therefore checked
by content, for CSS class names that only exist after the voice-layout commit:

| Bundle | `voice-callbar` | `sm-phone-device` |
| --- | --- | --- |
| Windows dist (`windows-build/dist`) | present | present |
| Linux dist (`linux-sep9/dist`) | present | present |

That check found a real problem on the third artifact. The APK staged from
`website/downloads/SMARAN-AI.apk` was 33,626,744 bytes from Sep 8 23:44 — while
the actual current build, `frontend/android/app/build/outputs/apk/release/
app-release.apk`, was 33,627,132 bytes from Sep 9 02:57, matching the Capacitor
assets synced at the same minute. The stale APK would have shipped a phone
build without the call-screen fixes, which is the release's headline change.
Both the release asset and the website's own copy were replaced.

The Windows installer had the same trap: `dist-release/SMARAN.AI-Setup.exe`
(Sep 8 01:14, 280,229,708 bytes) is older than
`.cache/audit/windows-installer/SMARAN.AI-Setup.exe` (Sep 9 03:43,
280,316,613 bytes). The newer one was published.

### Published

`v2.10.34` on `SHASHWAT-MISHRA-997/SMARAN.AI-downloads`, eight assets, the same
names v2.10.33 used so the website's fixed URLs keep resolving. Each URL the
download page actually links to was requested afterwards:

```
SMARAN.AI-Setup.exe              200   280316613
SMARAN.AI-x86_64.AppImage        200   369089016
smaran-ai_amd64.deb              200   306066488
smaran-ai.x86_64.rpm             200   397331333
smaran-ai-linux-x86_64.tar.gz    200   399259516
smaran-linux-x86_64              200     8180600
smaran.exe                       200    10184306
SMARAN-AI.apk                    200    33627132
```

Every Content-Length matches the staged file byte for byte.

The release notes lead with the rpm permission fix and say plainly that anyone
who installed the 2.10.33 rpm should replace it, since that package is the one
that shipped a world-writable binary in `/opt`.

### Website

`website/downloads/SMARAN-AI.apk` refreshed to the current build — the download
page serves that file directly rather than redirecting to the release.

The size labels in `index.html` are replaced on load from the releases API, so
they were already going to be correct; the hardcoded text is only the fallback
when that request fails. It had drifted far enough to be misleading on its own
(202 MB against a 267 MB installer, 299 MB against a 352 MB AppImage), so the
fallbacks were corrected to 267 MB, 352 MB, 33.6 MB and 9.7 MB, computed with
the same divisor `main.js` uses for each file.

Deployed to production, `smaran-ai.netlify.app`, two files changed. Read back
from the live site rather than from the deploy log:

```
$ curl -I https://smaran-ai.netlify.app/downloads/SMARAN-AI.apk
HTTP/1.1 200 OK
Content-Length: 33627132
Content-Type: application/vnd.android.package-archive
```

That is the Sep 9 build, byte for byte, served with the MIME type that makes a
phone install it rather than open it. The size fallbacks read back as 267 MB,
33.6 MB, 352 MB and 9.7 MB.

### Not verified

- Nobody has downloaded and installed these artifacts from GitHub; the checks
  above are on the staged bytes and on the URLs resolving.
- The Windows installer remains unsigned. SmartScreen will warn and Smart App
  Control will block it, which the release notes state.
- Speech accuracy is unchanged and untested, as it has been throughout.
# Fresh continuation audit — delayed speech final result

Read the newly supplied handoff and checked HEAD `e15fe8b`. Existing mobile
layout/release changes were preserved. Fresh backend/CLI execution: **325 passed,
12 warnings in 45.08s** (`.cache/audit/current-backend-tests.log`). Fresh frontend
baseline: **68 passed**.

Found a race in `pollFinalTranscript`: a delayed final result took precedence
over resumed speech, allowing a preceding phrase to end a turn while the user
was speaking again. Added a regression exercising both conditions together;
it failed before the fix. Resumed speech now precedes final text, while closed
or muted calls retain highest priority. Frontend suite after the change:
**69 passed**. Evidence: `current-voice-race-before.log` and
`current-frontend-tests-after.log` under `.cache/audit/`.

Physical accuracy is still not verified: the fresh `adb devices` command
returned an empty device list. This timing fix is not an acoustic recognition
accuracy claim. No APK installation, release, deployment, or merge was made
in this continuation.
# Connected-device follow-up

ADB serial `8f807260` authorized, Android user 0. Rebuilt Android release:
`current-android-build-retry.log`, BUILD SUCCESSFUL in 31s. The first build
did not leave a final success result and was not treated as verified.
`adb install -r` returned Success; user data preserved. APK SHA256:
`FA54E293CD311D436A677B1A781676F3AB86D172BA6400DD303459648C9CDAA3`.
Compared APK index.html and index JS bytes to current frontend build: equal.
Launched installed app and observed chat render in `current-phone.png`.

Browser run initially passed 6/7: one test clicked a reply's Speak button
instead of the composer voice-conversation button. Scoped its locator to
`chat-composer`, without weakening assertions. Fresh rerun: **7 passed in
11.8s**, including portrait/landscape separation of character and captions.
Logs: `current-mobile-browser.log`, `current-mobile-browser-after.log`.

Requested a known Hindi/Hinglish reference utterance with a two-second pause
on the newly installed APK. Physical accuracy remains pending that comparison.
No release deployment, merge, or Windows/Linux rebuild in this follow-up.

## Owner acceptance — Dictate

The owner confirmed: "HA ye maine test kiya Accuracy sahi hai" for the
requested Hindi/Hinglish reference sentence with a two-second pause on the
new APK. Record this as **owner-confirmed Dictate accuracy for that sample**,
not as an automated observation or proof for all languages. Speak recognition,
answer correctness, and perceived voice quality still need separate acceptance.

## Speak failure and follow-up fix

Opened Speak on the connected phone and observed Amarya with no desktop view
HUD (`speak-open.png`). Owner then reported no recognition and no reply. This
is a **failed Speak acceptance test** despite Dictate passing. Android log
reported recognizer error 7. Code inspection found Speak opens a WebView
recorder concurrently with Android recognition, unlike Dictate. Removed that
parallel capture on native Android; text events retain turn timing. This is
a plausible microphone-contention fix, not yet proof of acoustic recovery.
Frontend units: 69 pass; lint/build and Capacitor sync completed.

Also reproduced desktop startup failure with a broken system HTTP proxy and
a real local HTTP health server. Both readiness and existing-instance probes
now use an explicit proxy-free opener, restricted to their fixed loopback URL.
Regression failed before the fix; all 13 native desktop tests pass afterward.
Evidence: `proxy-before.log`, `proxy-after.log` under `.cache/audit/`.

Android follow-up built successfully in 36s and `adb install -r` returned
Success. APK SHA256:
`46FD9FF7C33713B157D7C35E76BA7217EC41813F567EE03615627198DE3259A9`.
App relaunched. Actual Speak acceptance on this microphone-ownership change
remains pending; the preceding failure is not erased. Desktop source fix has
not yet been rebuilt into the published Windows/Linux packages.

## Owner acceptance — Speak after microphone ownership fix

The owner confirmed "ha aab sahi kaam kar raha hai" after installing APK
SHA256 46FD9FF7C33713B157D7C35E76BA7217EC41813F567EE03615627198DE3259A9
and being asked to repeat the Speak question. Record as owner-confirmed
Speak functioning after the fix. Together with the earlier Dictate sample,
both reported mobile voice workflows now have user acceptance. This does
not establish all-language accuracy, subjective voice naturalness, or
completion of unrelated release/platform work.

## Final-work continuation: builds and real coding workflow

Fresh full backend/CLI run after the loopback proxy fix: 326 passed, 12
warnings in 51.03s (`current-full-final.log`).

Downloaded Windows and Linux CLI assets directly from GitHub v2.10.34 into
project audit storage. Both SHA256 hashes match their staged release assets;
both downloaded binaries actually run and report `smaran 2.10.34`.
Evidence: `downloaded-cli-verify.json`, `downloaded-linux-cli-verify.json`,
`downloaded-cli-version.log`, `downloaded-linux-cli-version.log`.

Started current Windows and Linux frozen builds in isolated output trees.
An initial Linux snapshot cleanup failed (FileExistsError); retried in a new
isolated output tree, preserving release artifacts. Build completion and
packaged startup are not yet verified.

Real VS Code host: configured Groq key was unavailable, recorded from fresh
host logs. Extended the scenario harness to allow the installed local Ollama
model without credentials and to persist missing-credential failures. Local
qwen2.5-coder:7b opened the actual agent panel and wrote stats.cjs, but wrote
Markdown fences into JavaScript and subsequently produced malformed calls.
At this checkpoint the run is still in bounded retries, not an acceptance pass.
Audit: `.cache/current-coding/extension-live-scenario.json`.

GPU probe: RTX 2060, 6 GB total / 5 GB free VRAM, CUDA available. This does not
prove video generation (`current-video-hardware.json`). No new release or
production deployment in this continuation.

---

## Continuation after Codex — verifying its work, and finishing the packaging

Picked up a working tree where Codex had made changes but committed none; HEAD
was still `e15fe8b`. Nothing was reset or discarded. What follows is my own
execution, not a reading of Codex's notes.

### Its changes, run rather than reviewed

| Suite | Result |
| --- | --- |
| `backend/tests/` | **312 passed**, 12 warnings, 67s |
| `cli/tests/` | **14 passed** |
| `frontend/tests/*.test.mjs` | **69 passed** |
| `vscode-extension/test/*.test.js` | **9 passed** |

The frontend suite needs `node --experimental-vm-modules`; without it
`native-speech.test.mjs` dies on `vm.SyntheticModule is not a constructor`,
which is a harness gap and not a failure of the code under test.

Two of the changes are worth stating plainly because they are corrections to
work of mine:

- **`pollFinalTranscript` had the precedence backwards.** I had `final` ahead of
  `resumed`, so a recogniser that committed "Please open" during a breath would
  send it while the speaker was still finishing the sentence — the same
  cut-off-sentence bug the function exists to prevent, arriving by a different
  route. Codex swapped the two and added a regression that fails on the old
  order. Correct. I updated the docstring, which still described the old
  precedence and would have invited the change to be reverted as a mistake.
- **`desktop_app.py` now bypasses the proxy for its own loopback health check**
  (`build_opener(ProxyHandler({}))`). I had previously chased this as an
  environment problem and set `NO_PROXY` in my own test runs; the app itself was
  still exposed to it. Doing it in code is the right fix, and
  `test_local_health_ignores_broken_system_proxy` pins it with a real server
  behind a deliberately dead proxy.

### The live coding scenario — a real run, and an honest failure

Previously blocked on provider quota. Codex extended the harness so an empty
`smaran.provider` selects local Ollama, which is how this extension has always
addressed `127.0.0.1:11434`, so no credential is involved.

Run against `qwen2.5-coder:7b` with `--extensionDevelopmentPath` **and**
`--extensionTestsPath` (the first is not optional; without it VS Code opens,
exits, and leaves the previous result file to be misread as a pass — which has
happened here before). The result file was deleted first for the same reason.

`code.cmd` returns immediately on Windows, so the first attempt reported "no
result file" after two seconds. The runner now waits on the `running` flag the
scenario itself writes.

**The scenario fails, and it should.** The model opened the real agent panel and
called `list_files` correctly, then wrote this as the contents of `stats.cjs`:

```
```javascript
module.exports = {
  summarize(numbers) {
```

A Markdown fence inside a `.js` file. It then produced three malformed tool
calls in a row and the run stopped with:

> The model returned unusable tool calls three times in a row. The task is
> incomplete. Try a different coding model; files already written are preserved.

`"passed": false`. That is the correct outcome: a 7B local model is not able to
complete this task, and the extension now says so in three attempts instead of
looping. The retry cap is Codex's, and this run is the evidence it works.

**What this does and does not show.** It shows the extension driving a real
model in a real VS Code host, refusing to report completion it did not achieve,
and preserving written files. It does **not** show the extension completing a
coding task, because no model that can was available. That still needs a
capable provider.

### Linux packages, which Codex had not built

Codex left fresh Windows and Android builds but no Linux packages. Both fresh
dists carry frontend bundle `B6fxkF2r`; the artifacts published as 2.10.34 carry
`eqH8Q4pS`, so the published Linux packages predate the voice work.

Built from `.cache/audit/linux-voice-final`, whose `dist/linux` did not exist,
so `build_linux.sh`'s `rm -rf` could not reach the published `linux-sep9`
artifacts — checked before starting, and those four files are still there.

```
smaran-ai_2.10.34_amd64.deb            306064440
smaran-ai-2.10.34-linux-x86_64.tar.gz  399260618
smaran-ai-2.10.34-1.x86_64.rpm         397331618
SMARAN.AI-2.10.34-x86_64.AppImage      369089016
```

The rpm permission fix has **not** regressed:

```
entries: 1759   world-writable: 0   owner: root root
-rwxr-xr-x  root root  41823176  /opt/smaran-ai/SMARAN.AI
```

and the rpm payload carries `index-v2.10.34-B6fxkF2r.js`, so these packages do
contain the voice work.

One thing that looked wrong and is not: the new AppImage is 369089016 bytes,
byte-for-byte the same size as the published one. Its SHA-256 is
`e8b8218...`, against the published `55389cf...`, so it is a different build;
squashfs simply landed on the same total.

### Owner acceptance

The owner reports that Dictate and Speak both now work correctly, tested by
them on the phone. Recorded as **owner acceptance**, which is what it is — I
have no microphone and made no acoustic measurement. This closes the item that
has been open since the first pass, and it closes it on the owner's word rather
than on anything I observed.

### Not verified

- Every current artifact is built but **none of it is published**. The live
  2.10.34 release and the website still serve the pre-voice-fix builds. Nobody
  downloading today gets the Speak fix.
- The extension has still never completed the live coding task, only failed it
  correctly.
- Energy Core / Amarya voice quality and arm motion remain unjudged.
- The Windows installer is still unsigned; the rpm still untested on an
  rpm-based distribution.

---

## 2.10.35 — version bump, full rebuild, published

2.10.34 was published earlier the same day and then found to be wrong: Speak was
broken on Android and the desktop app could refuse to start behind a system
proxy. The owner chose a real version bump over replacing 2.10.34's assets in
place, so that two different builds never share one version number.

### The bump

The version is baked into every frozen binary, so a bump means rebuilding
everything. Six source locations, all of them:

```
backend/app/updates.py            APP_VERSION
backend/app/usage_reporting.py    APP_VERSION
cli/smaran_cli/__init__.py        __version__
frontend/android/app/build.gradle versionName 2.10.35, versionCode 21035
frontend/package.json             version
installer/SMARAN.AI.iss           AppVersion
```

`cli/pyproject.toml` needed no edit; its version is `dynamic` and read from
`smaran_cli.__version__`. The Android `versionCode` matters as much as the name:
Android refuses to install an update whose code has not increased.

Suites after the bump: **312 backend, 14 CLI, 69 frontend**, unchanged.

### Rebuilt, and checked by running rather than by date

| Artifact | Evidence |
| --- | --- |
| Frontend | bundle `index-v2.10.35-_zVm7Sms.js` |
| Windows app | started; `{"status":"ok","app":"SMARAN.AI","version":"2.10.35"}`, frontend 200 |
| Windows installer | compiled against the new dist, 280,263,461 bytes |
| Linux app | extracted from the rpm and started; same ping, version **2.10.35**, frontend 200 |
| Linux packages | four, all 2.10.35 |
| APK | carries `index-v2.10.35-_zVm7Sms.js`, versionCode 21035 |
| Windows CLI | `smaran 2.10.35` |
| Linux CLI | `smaran 2.10.35`, run with `PYTHONPATH` unset |

The rpm permission fix has not regressed across either rebuild:

```
entries: 1759   world-writable: 0   owner: root root
-rwxr-xr-x  root root  41823176  /opt/smaran-ai/SMARAN.AI
```

Two build-environment notes. `ISCC.exe` is at
`C:\Users\shash\AppData\Local\Programs\Inno Setup 6\`, not under
`Program Files (x86)`; the first compile failed on that path. And the Windows
run logged `WinError 4551, An Application Control policy has blocked this file`
for `video-packages\torch\lib\caffe2_nvrtc.dll` — that is this machine's Smart
App Control refusing an unsigned DLL under user data. The app started and served
anyway; it is the same unsigned-code limitation already recorded, not a fault in
the build.

### Published

`v2.10.35`, eight assets, same fixed filenames so the website's
`releases/latest/download/<name>` links keep resolving. Every URL requested
afterwards:

```
SMARAN.AI-Setup.exe              200   280263461
SMARAN.AI-x86_64.AppImage        200   369089016
smaran-ai_amd64.deb              200   306065774
smaran-ai.x86_64.rpm             200   397327886
smaran-ai-linux-x86_64.tar.gz    200   399254137
smaran-linux-x86_64              200     8182776
smaran.exe                       200    10010401
SMARAN-AI.apk                    200    33627158
```

Every Content-Length matches the staged file. Website deployed; the APK it
serves directly reads back at 33,627,158 bytes, the same build. The one size
fallback that actually moved was `smaran.exe`, 9.7 → 9.5 MB.

### Not verified

- Nobody has installed these from GitHub; the checks are on staged bytes and on
  the URLs resolving.
- The installer is still unsigned, and the rpm still untested on an rpm-based
  distribution.
- Speak and Dictate are owner-accepted on the phone, on a build with the same
  frontend as this one — but the owner tested the APK Codex installed, not this
  release APK. The code is identical; the installation was not repeated.

---

## Device control on the phone, and 2.10.36

### What the logs settled that reasoning did not

Opening an app from the plugin failed silently at first: the call reported
success, nothing was refused, and the app never appeared. The cause was the
context. `getContext()` on a Capacitor plugin is the Application context, and
an activity started from it is a background launch, which Android has
restricted since 10. Launching from `getActivity()` fixed it, and the log then
said exactly why it now worked:

```
START u0 {... pkg=com.android.chrome ...} mCallingUid=10470
  with LAUNCH_SINGLE_INSTANCE_PER_TASK
  (BAL_ALLOW_VISIBLE_WINDOW (callingUid has visible non-pinned window))
  result code=0
```

That same line then explained why the floating window could not work the way it
was first written. The launch is allowed because this app has a **visible,
non-pinned** window - and a picture-in-picture window is pinned. Floating first
removes the permission the launch depends on. Floating afterwards fails too:
by then the launched app is resumed and this one is not, and
`enterPictureInPictureMode` is only honoured for a foreground activity.

`setAutoEnterEnabled` is the resolution. The window is armed while still in
front, the launch proceeds under the allowance it needs, and Android floats the
activity itself as it steps aside. It is disarmed on the next resume, because
auto-enter is a property of the activity rather than of one launch, and leaving
it on would float the app every time Home was pressed for any reason.

Observed in one run on the phone:

```
isAutoPipEnabled=true            (armed, 11 log lines)
START u0 ... pkg=com.whatsapp    (the app launched)
PipTransitionState(mState=entered-pip)  aspectRatio=9/16
```

and the call said "Opening WhatsApp." aloud. Chrome was seen starting the same
way on an earlier run. Detection, launch, spoken confirmation and the float are
therefore all evidenced.

### Two bugs the tests caught before the device did

- The music patterns have no capture group, so `match[1]` was `undefined` and
  the rule treated a perfectly good match as a failure. "gaana bajao" did
  nothing.
- Politeness lands *after* the verb in Hinglish - "Chrome kholo zara" - which is
  past the anchor the verb-last pattern needs, so it has to come off the
  sentence before matching rather than off the captured name afterwards.
  `karo` and `kar do` are deliberately excluded from that list: they are the
  verb in "chalu karo", and stripping them leaves "calculator chalu", which
  matches nothing.

18 tests on detection, including that a refusal, a question and a quoted
command do not run, and that "awaz band karo" is still an instruction.

### The caption follows the voice

Highlight verified on the device earlier: mid-sentence the lit text ran through
`**On a computer` while the rest stayed dim, and those asterisks being inside
the highlight is the word alignment working, since the voice never says them.

The scroll rule has 8 tests of its own. It follows the boundary between spoken
and unspoken text and only once that boundary leaves a band between a quarter
and seven tenths down the box, so it steps rather than jitters.

**Not watched on the device.** Repeated attempts to drive a long reply by adb
taps ended in a muted microphone, an ended call and a fresh session with
nothing to re-speak. The rule is unit tested and the code path is shared with
the highlight that was seen working, but the scrolling itself has not been
observed on the phone.

### 2.10.36

Same six version locations as 2.10.35, `versionCode` 21036 with it. Checked by
running, not by date:

| Artifact | Evidence |
| --- | --- |
| Linux app, from the rpm | `{"status":"ok","app":"SMARAN.AI","version":"2.10.36"}`, frontend 200 |
| Linux packages | four, bundle `index-v2.10.36-B2VLBXb8.js` inside the rpm |
| rpm permissions | 1759 entries, **0 world-writable**, root:root |
| APK | carries the same 2.10.36 bundle |
| Windows CLI | `smaran 2.10.36` |
| Linux CLI | `smaran 2.10.36`, `PYTHONPATH` unset |

110 frontend tests, lint and build clean.

Published as `v2.10.36`, eight assets under the same fixed filenames. Every
download URL requested afterwards returned 200 with a Content-Length matching
the staged file byte for byte. Website deployed; the APK it serves directly
reads back at 33,632,226 bytes, the same build.

### Not verified

- The caption scrolling, on the device (above).
- Nobody has installed these from GitHub; the checks are on staged bytes and
  URLs resolving.
- The Windows app at 2.10.36 was frozen and packaged but not started; the Linux
  one was. Both come from the same source and the same frontend bundle.
- Opening apps by voice was exercised with WhatsApp and Chrome. Music, YouTube
  and spoken web addresses are covered by tests but were not run on the phone.
- The installer remains unsigned, and the rpm untested on an rpm-based distro.

---

## Bundled media, and a folder for models of your own

### What an audit of the shipped assets found

Started from a request to set up free code signing. The only genuinely free
route is the [SignPath Foundation](https://signpath.io/solutions/open-source-community),
which Microsoft's own documentation recommends and which signs qualifying
open-source projects at no cost. It requires an OSI licence **and no
proprietary component**, so the bundled media had to be checked.

| Asset | Provenance |
| --- | --- |
| `characters/evelyn` ("Amarya") | Terms inside the PMX: 请勿二次配布 (do not redistribute), 请勿用于商业用途 (not for commercial use), author 观海子, 最终解释权归属 miHoYo |
| `avatar-video/*.mp4` ("Myra") | No attribution, metadata stripped; an audit of another application found byte-identical clips |
| `pets/smaru/spritesheet.webp` | No attribution; also **unreferenced** - the pets are drawn in code |
| `headaudio` | MIT, Mika Suominen ✓ |
| `mediapipe` | Google, Apache-2.0 ✓ |

The PMX terms are readable with a short decode of the header: PMX 2.0 stores
name and comment as length-prefixed UTF-16LE, and the comment is the author's
licence. Recolouring and physics fixes are permitted there; redistribution is
not, and the model currently ships in the APK, installer, deb, rpm, tar.gz and
AppImage.

**The owner's decision is to keep the character.** That is recorded here as an
open item rather than argued with: free code signing stays unavailable while a
proprietary component ships, and the redistribution question is unresolved. No
asset was removed.

### The folder beside her

What was added instead is additive and removes nothing. `DATA_DIR/characters/`
is served read-only at `/api/characters/files` and listed by `GET
/api/characters`; a folder dropped in there appears in the character picker
alongside Amarya. A directory rather than a file upload, because a PMX
references its textures by relative path and a lone file loads untextured.

Nothing is copied, converted or sent anywhere - the model is read from the
user's own machine, so whatever its licence permits stays between them and
whoever made it.

10 tests on the listing. The ones that earned their place: a loose `.pmx` at the
top level is not a character (its textures would be missing), a folder without a
model is skipped rather than half-listed, a name with spaces survives as an
encoded URL, a name containing `..` is encoded rather than obeyed, and a folder
deleted while the app runs is an empty list rather than a crash.

Two things were reverted after the owner said to keep the character: the picker
default returned to `anime-girl`, and the ambience profile to its original
per-character form. What is left changes no existing behaviour.

One defensive change was kept deliberately. `MMD_CHARACTERS[0]` was the fallback
when a saved character id no longer matched, and it is only defined while a
model ships - so any build without one threw on `.file` rather than falling back
to something drawable. It now checks.

Suites: **336 backend and CLI**, **110 frontend**, lint and build clean.

### Not verified

- The picker has not been exercised with a real user-supplied model on a device;
  the listing is tested, the loading path is the same one Amarya already uses.
- The redistribution question above is open, by decision, not by oversight.

---

## Vega — a character with no asset behind her

Asked for a character that is fully open source. Rather than sourcing another
model whose terms someone else sets - the situation that started this - she is
generated from primitives at runtime: no model file, no texture, nothing
downloaded, MIT like the code around her.

She is deliberately not a person. A humanoid built from spheres lands in the
uncanny valley immediately, so she is a constructed figure: visor band across
the eyes, tapered torso for a shoulder line, arms floating in two segments with
no skinning and no elbow that can bend the wrong way. Nothing is rigged, which
is also why she costs a fraction of the MMD path to load.

She reads the same signals as the other avatars, so the call screen does not
care which is on stage: the mouth opens on the assistant's real audio level,
listening leans her in and widens the eyes, thinking tilts her and spins the
rings up.

### Two bugs the bench found that reasoning did not

**A runaway canvas.** Nothing rendered at all on the first run. The host element
measured **26,843,546 pixels tall**. `setSize(w, h, false)` sets the drawing
buffer and deliberately does not touch CSS, so the canvas had no display size -
which means the browser laid it out from its `width`/`height` *attributes*,
which are the buffer, which is set from the parent's measured height. The parent
grew to fit, the ResizeObserver fired, and the two chased each other. Fixed by
giving the canvas an explicit `100%` CSS size, which is what `updateStyle:false`
assumes the caller has already done.

**A figure that read as a ball above a planet.** The first geometry was a head
sphere over a body sphere with two floating hands. It looked like a snowman with
a smile. The silhouette is what does the work: a tapered torso, a shoulder cap
and a visor band turned the same parts into a figure. The mouth was a plane,
which opened into a pink brick across her chin; a squashed disc is a line when
closed and a rounded oval when open.

### Verified

Looked at, not assumed. A bench at `frontend/tests/visual/vega.html` mounts her
alone with a stubbed audio source, following the pattern the Energy Core bench
already established, so each state can be driven without a backend or a live
voice.

All four states render and are distinguishable: idle upright, listening leaning
in, thinking tilted with the rings running, speaking with the mouth on the
level. An empty first screenshot of `idle` was the capture beating the first
frame, not a fault - it renders after a two second wait.

110 frontend tests, lint and build clean.

### Not verified

- She has not been seen on the phone or inside the real call screen, only in
  the bench.
- Nothing about her changes the licensing position of the assets that ship
  alongside her; Amarya and Myra are untouched, by decision.

---

## VRM characters, and Vega deleted

The owner's verdict on the code-drawn character was unambiguous: ugly, not
futuristic, not attractive. That is fair, and the underlying reason is worth
recording rather than tuning around. **Ultrarealistic is not reachable with
hand-written primitives.** A convincing face needs a sculpted mesh, PBR
textures, hair geometry and skin shading - an *asset*, which is exactly what
the licensing problem is about. Spheres and cylinders written in JavaScript will
not get there however long they are adjusted.

`AvatarVega.jsx` and its bench are deleted. Recoverable from `5ee1cf3` if it is
ever wanted.

### The route chosen instead

VRoid Studio: free software from pixiv where the owner designs the character
themselves, and **owns what they make**. That clears the licence question at the
source rather than working around it, and it would make the project eligible for
free code signing if the other assets were ever resolved too.

`@pixiv/three-vrm` 3.5.5 turned out to be **already a dependency and completely
unused** - declared by an earlier pass and never wired up. So this needed no new
package.

### What VRM gives that MMD does not

The MMD path matches morph names against a list of spellings seen in the wild,
because PMX models disagree about what a mouth shape is called. VRM standardises
it: real visemes (`aa`/`ih`/`ou`/`ee`/`oh`), `blink`, moods, a humanoid skeleton
with named bones, and a look-at rig. None of it has to be guessed.

`AvatarVRM.jsx` drives visemes from the assistant's own audio, blinks on a
timer, leans the spine when listening, tilts the head when thinking, and calls
`vrm.update(delta)` every frame - without which spring bones never move and the
hair is welded in place.

Two details that would otherwise bite:

- `VRMUtils.rotateVRM0` turns a VRM 0.x model round. Without it an older export
  stands with her back to the person talking to her.
- The canvas gets an explicit CSS size, the same fix the deleted component
  needed: `setSize(w, h, false)` leaves style alone by design, and a canvas with
  no CSS size is laid out from its buffer attributes, which are set from its
  parent's height.

### The characters folder now takes either

A `.vrm` is one file carrying its own textures, so it can sit directly in
`DATA_DIR/characters/`. A `.pmx` references textures by relative path and still
needs a folder. Both are listed, and the page picks a renderer from the file
extension rather than from a type recorded anywhere.

13 tests on the listing. The pair that matter: a loose `.pmx` is **not** offered,
because it would load untextured, while a loose `.vrm` **is**, because it is
complete on its own. A folder holding both prefers the VRM.

Suites: **339 backend and CLI**, **110 frontend**, lint and build clean.

### Not verified

- **No VRM has been loaded.** There is no `.vrm` file on this machine and
  fetching one would repeat the licensing mistake. The loader, the renderer and
  the routing are written and typecheck-clean but have never run against a real
  model. This is the next thing to test, on the owner's own export.

---

## The VRM loader, run against a real model at last

No `.vrm` existed on this machine and the owner's VRoid install had not
finished, so with permission a sample was downloaded purely to test with:
`VRM1_Constraint_Twist_Sample.vrm` from pixiv's own three-vrm repository, which
is MIT. 10,776,032 bytes, magic bytes `glTF`.

**It loads.** First run put a real anime character on screen - face, hair,
clothing - through the same component the call screen uses. The listing found
it correctly too, reporting `name: "SampleGirl"` without the suffix and
`id: "SampleGirl.vrm"` with it.

### Three things the first real run exposed

**A T-pose.** She loaded with her arms straight out sideways. That is not a
fault in the export: VRM *defines* the rest pose as a T-pose, and three-vrm's
normalized bones are expressed in that space, so identity means arms out. The
fix has to be an absolute rotation rather than a relative nudge - because the
space is defined by the specification rather than by the model, the same
absolute value lands correctly on every character, while a relative offset
would over-rotate an export that already had its arms down.

**A bench that lied about its own size.** The stage measured 940px inside an
860px viewport, so what the bench showed was not what the app would show.
`height: 100%` let the controls row push the stage past the bottom of the
window; `position: fixed; inset: 0` fixes it. It still reports 872 against 860
and that is cosmetic to the bench alone, not to the app.

**A model staged where it would have shipped.** To serve the file to the bench
it was copied to `frontend/public/`, which is bundled into every build - the
installer, the APK, the AppImage, all of it. Removed. The file lives in
`data/characters/` instead, which is gitignored user data and is also the folder
the feature is actually about.

### Verified by looking

| | |
| --- | --- |
| Loads and renders | a real character, not a placeholder |
| Arms | posed down from the spec T-pose |
| Mouth | open in `speaking`, closed in `idle` - the visemes are driven by the audio level |
| Hair | present and hanging, so spring bones are being updated |
| Listing | single `.vrm` offered, name without suffix |

110 frontend tests, lint and build clean.

### Not verified

- Only one model has been through it. A VRoid export is a different rig with
  different expressions, and the camera framing in particular is set from
  generic proportions and will want adjusting per character.
- Not yet seen inside the real call screen, only in the bench.
- Not seen on the phone.
- The sample is a test fixture, not a shipped character. Nothing about it is
  bundled, and the licensing position of Amarya and Myra is unchanged.

---

## All of the above, removed

The owner does not want the VRoid route. Everything built for it is reverted:
`AvatarVRM`, the VRM bench, the user-characters folder and its endpoint, the
listing tests, and the downloaded sample model. `data/characters/` is gone
along with the sample it held.

The sections above are kept rather than deleted with the code, because two
findings in them are true whatever gets built:

- The bundled `characters/evelyn` model states its own terms inside the PMX -
  请勿二次配布 (do not redistribute), 请勿用于商业用途 (not for commercial use),
  final rights to miHoYo - and it ships in the APK, installer, deb, rpm,
  tar.gz and AppImage.
- The `avatar-video` clips carry no attribution at all, and the pet spritesheet
  is both unattributed and unreferenced.

That is why free code signing is unavailable: SignPath Foundation, the only
free route, requires no proprietary components. Nothing about the removal
changes it.

Amarya, Myra and the Energy Core are untouched and remain the characters. State
after the revert: **326 backend and CLI**, **110 frontend**, build clean.
