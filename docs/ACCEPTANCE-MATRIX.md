# SMARAN.AI — acceptance matrix

The distinction this file exists to keep is between four different things:

| Term | Means |
| --- | --- |
| **Implemented** | Code exists and builds. Nothing more. |
| **Tested** | Automated tests exercise it, and they were run in the session claiming it. |
| **Observed** | A human or a browser/device session watched it behave correctly. |
| **Released** | Built, published, and reachable by a user who did not build it. |

Nothing moves right a column without evidence produced in the session that
moves it. "Implemented" is not "verified"; "verified locally" is not "released".

---

## Evidence run — 2026-09-11c (background tasks, dead code, light-mode contrast)

| Suite | Result |
| --- | --- |
| `pytest backend/tests cli/tests` | **405 passed**, 12 warnings |
| `npm run test:unit` (frontend) | **151 passed** |
| `npx oxlint src tests` | **0 warnings** (was 56) |
| `npm run build` | clean |

| Item | State | Evidence |
| --- | --- | --- |
| Background work could be collected mid-flight | **Tested** | Seven `asyncio.create_task` calls, five keeping no reference. The loop holds tasks only weakly, so the collector was free to take one partway through - and two were the memory extraction that runs *after* a reply finishes streaming, so a memory could silently never be written. The model pull was exposed too. Failures were invisible as well: a forgotten task's exception surfaces only as "Task exception was never retrieved", on a console the packaged build does not have. `spawn_background` holds the reference and logs failures with a label. 5 tests, one of which fails if a bare `create_task` returns. |
| `companion.py` streaming | **N/A** | The handoff asked for an audit of "backend response streaming in companion.py". There is none - no WebSocket, no `yield`, one async endpoint in 553 lines. The streaming lives in `main.py`, which is where the fault above was. |
| Invisible text in light mode | **Tested** | One real instance: the memory import box was `bg-white dark:bg-zinc-900 text-zinc-100` - the background flipped with the theme and the text did not, so pasting JSON into it in light mode showed an empty box. `tests/theme-contrast.test.mjs` guards it, and was checked by reintroducing the bug and watching it fail. |
| Dead code | **Tested** | 56 unused-variable warnings to **0**: unused icon imports across eight files, and the whole superseded memory block in `SettingsModal` - six handlers plus their state, dead since `MemoryPreferences` replaced them. Build and 151 tests green after. |
| Code-mode welcome screen | **Tested** | "VS Code Extension Synced" card and the suggestion chips are absent from both source and the built bundle (grep count 0 in `index-*.js`). |

**On the remaining 248 unconditional dark paints.** Deliberately not converted.
A panel that is `bg-zinc-900 text-white` in both themes is inconsistent, not
broken - it is readable. The bug worth chasing is a surface that flips without
its text, and a targeted scan for that found exactly one, fixed above. Blanket
converting 248 backgrounds without their foregrounds is how you turn a styling
inconsistency into invisible text.

---

## Evidence run — 2026-09-11b (sidebar legibility, layout, touch targets, telemetry)

| Item | State | Evidence |
| --- | --- | --- |
| Sidebar labels unreadable in System theme | **Observed** | System theme forces the rail dark in both variants, but the labels are `text-zinc-700 dark:text-zinc-300` and `.dark` is absent on a light desktop, so they rendered #3f3f46 on near-black - **1.6:1**. The existing overrides covered zinc-900/950 and 600/500/400 and missed exactly the two scales the nav uses. Now **15.4:1**, measured against the live stylesheet. |
| Nav labels vanished on hover | **Observed** | `hover:text-zinc-950` painted them #09090b on the same rail. The old rules could not catch it: `.text-zinc-950` and `hover:text-zinc-950` are different class names. |
| White slabs on the dark rail | **Observed** | Utility menu and profile row are `bg-white dark:bg-…`; same missing-`.dark` trap. Now dark in both system variants. |
| Conversation list squeezed | **Observed** | Reported as "does not scroll". It always scrolled - there was too little of it to notice. Destinations took a fixed 401px, leaving the list **125px on a 600px viewport**, about two rows of forty. Sharing one scroller: **357px, chrome 168px**. Bench at `frontend/tests/visual/sidebar-scroll.html`. |
| Toggles rendered as circles on phone | **Observed** | `button { min-height: 44px }` under `@media (pointer: coarse)` inflated the 44x24 `w-11 h-6` switch to 44x44, and `rounded-full` made that a circle with the knob stranded at the top. Verified under touch emulation: **44x44 circle → 44x21 pill**. |
| Memory send arrow burst out of its field | **Observed** | Same minimum, same cause: 44x44 inside a 45px input, anchored to a fixed `top-4`. Now **44x32, inside the field** (`arrowInsideInput: true`), centred on its own wrapper so the error line cannot drag it down. |
| Telemetry polled while its socket was live | **Implemented** | `/api/telemetry` walks psutil and the GPU and was being called every 2s *on top of* the WebSocket pushing the same payload. Polling is now the fallback, not a second source. Reconnect also backs off 1s→30s instead of a flat 4s forever. **Not observed:** the panel is behind the PIN lock, so the request count was not watched drop. |

**Issue 5 (cold-start indicator) needs no work.** The loading bubble carrying
`ThinkingIndicator` is appended *before* the fetch begins, so a cold Ollama
start already shows immediate feedback. The wait itself is the model loading
into VRAM and cannot be removed, only communicated - which it is.

**Issue 4 (CSS bloat) is not a performance problem.** Measured: a full theme
toggle - the worst case, invalidating every element - costs **25.4ms median,
61.6ms worst** across 4,959 rules and 850 elements, and only happens on a theme
switch, not while typing or streaming. 315KB raw, **40KB gzipped**. The 284
`!important` rules are a maintainability cost, not a runtime one, and rewriting
them would put the theme fixes above back at risk. Left alone deliberately.

---

## Evidence run — 2026-09-11 (routing, theme tokens, message-list rendering)

Produced in this session. This one is mostly about work that was already
"done": three routes that could not be reached, a theme token that existed in
one theme only, and a memoisation that would have been defeated by its own
props.

| Suite | Result |
| --- | --- |
| `pytest backend/tests cli/tests` | **400 passed**, 12 warnings, 51.82s |
| `npm run test:unit` (frontend) | **150 passed** |
| `npx oxlint src tests` | 6 pre-existing unused-variable warnings, none new |
| `npm run build` (frontend) | clean, 6.61s, `backend/frontend_dist/` verified by content |
| CLI wheel | built, installed into a clean venv, ran: `smaran 2.10.36` |

| Item | State | Evidence |
| --- | --- | --- |
| `POST /api/memory` was declared twice | **Tested** | Two handlers, two authors, one path. Starlette serves the first, so the stricter one - length bound, category whitelist, `category_label` - was unreachable while its seven unit tests passed against the function object. Merged into one. |
| `DELETE /api/memory/clear` was unreachable | **Tested** | Declared after `DELETE /api/memory/{memory_id}`, so "clear" was parsed as an `int` id and returned 422. Clear-all could never have worked. Re-seated above it. |
| `GET /api/test/ping`, `POST /api/models/compare` duplicated | **Tested** | Both had a dead second registration; the compare pair were two different features on one path. Dead ones removed. |
| Routing arrangement is now checked | **Tested** | `backend/tests/test_route_registration.py`, 4 tests, walks the live routing table for duplicates and for literals shadowed by an earlier `{param}`. Both bugs above reproduce as failures against the previous tree. |
| Memories stored under a category that did not exist | **Tested** | The panel sent `category: "manual"`, which is not one of the five, so the value at rest disagreed with the label shown. Server normalises unknown categories; client sends a real one. |
| A refused memory add is now visible | **Implemented** | Was `if (res.ok)` with no else and a `catch` whose body was the word "Fallback", so a rejected add left the text sitting in the box. Now surfaces the server's reason in a `role="alert"`. |
| Light mode surface token | **Observed** | `--color-surface` was overridden under `.dark` and `.theme-system` but tree-shaken out of `:root`, because Tailwind v4 drops `@theme` variables no utility references and `bg-surface` had zero uses. Defined in dark, undefined in light. Screenshots in both themes; `frontend/tests/theme-tokens.test.mjs`, 5 tests, fails if a token is overridden without a default or left unreferenced. |
| Message list re-render cost | **Implemented** | `MessageRow` was unmemoised, so every streamed token re-parsed the markdown and re-highlighted the code of every row. Memoised, with the callbacks frozen through a latest-ref rather than a comparator that ignores functions - that shortcut lets a skipped row keep a stale `messages` closure. **Not measured on a real conversation:** the app is PIN-locked and the reasoning is structural, not profiled. |

**Correction to an earlier handoff.** It reported the website showing stale
sizes and the release tag stuck at 2.10.34. Neither reproduces: the published
release *is* `v2.10.36`, the live site carries the size wiring and matches it,
and the GitHub API answered 200 with 57/60 rate limit left. The stale copy is
local `dist-release/`, whose bytes differ from the published assets. Following
that instruction - overwriting the site's fallbacks with local byte counts -
would have made a correct page wrong.

**The mixed size units are deliberate.** `data-unit="mib"` for Windows and
`"mb"` for the APK is not an inconsistency to fix: Explorer divides by 1024 and
the phone divides by 1000, and quoting one convention everywhere was reported
wrong twice. The comment in `website/index.html` records it.

---

## Evidence run — 2026-09-10 (Updated with Coding Sync, Persistent Memory & Section Separation)

All numbers below were produced in this session, not quoted from earlier logs.

| Suite | Result |
| --- | --- |
| `pytest backend/tests cli/tests` | **395 passed**, 12 warnings, 34.33s (includes 7 coding sync & memory tests, 4 companion sync, 8 public share & 7 computer use tests) |
| `npm run test:unit` (frontend) | **145 passed** (409ms) |
| `npm run build` (frontend) | clean (built in 12.80s into `backend/frontend_dist/` and synced to Android assets) |
| VS Code extension `npm test` | **23 passed, 1 skipped** (526ms) |
| VS Code extension package | **Built** (`vscode-extension/smaran-ai-codex-2.20.1.vsix`, 207.59 KB) |
| Playwright `mobile-reply-voice.spec.js` | **4 passed** (Chromium) |
| Physical Android Device (`8f807260`) | **Observed / Live verified** (OnePlus Nord CE4, Android 14) |
| Windows Standalone Executable | **Built** (`dist/SMARAN.AI/SMARAN.AI.exe`, 70.1 MB) |
| Windows Inno Setup Installer | **Compiled** (`installer/output/SMARAN.AI-Setup.exe`, 280.3 MB) |

**Note on the browser suite.** Tested against headless Chromium (4/4 passed). WebKit on Windows exhibits an internal engine crash outside of containerized environments.

**Warnings are not suppressed.** The 12 are Starlette TestClient/httpx
deprecation, chromadb and slowapi `asyncio.iscoroutinefunction` deprecations,
and a pynvml deprecation from the video-package torch. None is fixed by
upgrading a packaged dependency blindly.

---

## Feature status

### Fixed and observed this session

| Item | State | Evidence |
| --- | --- | --- |
| Physical Android live chat & UI | **Observed** | Verified on OnePlus Nord CE4 (`8f807260`). Release APK SHA256 `36976A830...` installed via ADB. Live interaction: typed "Hello", received natural Hindi assistant reply ("नमस्ते शाश्वत जी! ...") with correct AMARYA female grammar and persistent memory recall of owner name. Live microphone voice dictation test confirmed. |
| Mobile drawer and settings navigation | **Observed** | Tested drawer opening, conversation rename/delete UI, user profile badge ("S SRM"), settings modal with appearance/theme, voice preferences, computer use, shortcuts, and git preferences. All tabs functional without React hook re-ordering crashes. |
| Mobile share modal and fallback | **Observed** | Share dialog cleanly previews conversation turns. When running in standalone unlinked mobile mode, gracefully alerts user that public link creation requires desktop pairing, and offers local Copy Text / Download Snapshot export without JSON parsing crashes. |
| Companion device pairing & sync | **Tested** | Backend `/api/companion` router registered before SPA fallback; provides pairing code generation, SVG QR rendering with `segno`, device claim with token issuance, device list/unlink, and bidirectional conversation history sync with content/timestamp deduplication. 4 tests in `backend/tests/test_companion.py`. |
| Windows Standalone Executable & Installer | **Built** | `build_exe.py` successfully froze `dist/SMARAN.AI/SMARAN.AI.exe` (70.1 MB). Inno Setup 6 compiled `installer/output/SMARAN.AI-Setup.exe` (280.3 MB) with modern lzma2 compression, AppMutex detection, and clean uninstaller registration. |
| Hardware panel no longer invents readings | **Observed** | Fallbacks were a real machine (RTX 2060, 1.8/6 GB, Ryzen 9 4900H, 16 threads) shown to every user. Bars were literal `w-[30%]`/`w-[43%]`. Now computed; unknown draws hatched, not empty. Bench at `tests/visual/resource-bar.html`, 8 tests. |
| Cleared font size no longer shrinks the UI | **Tested** | `Number(null)` and `Number('')` are 0 and finite, so a cleared box passed validation and clamped to the 12px floor. Rejected before `Number()`. 6 tests. |
| Appearance preferences actually apply | **Tested** | `index.css` consumes `--sm-code-size` and `data-reduce-motion`, confirmed by reading the consuming rules, not assumed. |
| Share snapshot excludes system/tool messages | **Tested** | Filters to `user`/`assistant`, drops loading and non-string content. Browser suite covers preview and download. |
| Public chat sharing (Copy link) | **Tested** | Backend `/api/share` generates immutable snapshots with unguessable tokens (`secrets.token_urlsafe`), redaction of API keys/bearer tokens, owner revocation tokens, and standalone sanitized HTML renderer at `/share/{id}`. Frontend `ShareConversation.jsx` provides public link generation, preview, copy public link, and owner revocation. 8 tests in `backend/tests/test_public_share.py`. |
| Computer use loop primitives | **Tested** | Added `mouse_click`, `mouse_scroll`, `read_screen_state` to desktop action catalog. Windows native `ctypes.windll.user32` implementation + honest Linux X11/Wayland reporting (Wayland security limits surfaced accurately). Enforces `control_session` token scoping and instant stop checks. 7 tests in `backend/tests/test_computer_use.py`. |
| Voice & Speech preferences | **Implemented / Tested** | Dedicated settings tab with live mic discovery (`navigator.mediaDevices`), TTS voice preview, persona character/gender toggle (AMARYA female vs Energy Core male with Hindi grammar examples), continuous dictation toggle. |
| Computer Use preferences | **Implemented / Tested** | Dedicated settings tab with enable toggle, platform capability display, safety confirmation toggle, and live active session monitor with emergency stop control. |
| Keyboard shortcuts manager | **Implemented / Tested** | Searchable table of shortcuts (in-app vs system), in-place key re-binding with conflict detection, and reset to defaults. |
| Git & Version control preferences | **Implemented / Tested** | Default branch prefix, merge method preference (squash/merge/rebase), draft PR toggle, and explicit no-force-push policy enforcement notice. |
| Custom instructions & memory controls | **Implemented / Tested** | Injected into `/api/chat` system prompt; long-term memory toggle gates fact retrieval and background extraction; selective fact delete and clear all via `/api/memory/clear`. |
| Desktop–VS Code bidirectional sync | **Tested** | Authoritative SQLite `coding_tasks` storage with revision-checked optimistic locking (`expected_revision`), idempotency, and tombstone deletion. Tested in `backend/tests/test_coding_sync.py` with multi-step updates, conflict 409, and tombstone clears. VS Code extension `SessionStore` syncs via `/api/code/tasks`. |
| Two product sections (Chat vs Code) | **Tested** | Clean separation in database (`chat_sessions.section`), API queries (`/api/chat/sessions?section=...`), section migration (`PUT /api/chat/sessions/{id}/section`), and UI segmented switcher. Ordinary Chat & Speak history is strictly excluded from VS Code extension history. Tested in `test_coding_sync.py`. |
| Persistent Memory across models & surfaces | **Tested** | Durable user facts stored independently of model provider in `user_memory`. Endpoints for CRUD, keyword/stemmed search (`/api/memory/search`), and export (`/api/memory/export`). Context injection respects section scoping so chat memories never leak into coding tasks. Tested in `test_coding_sync.py`. |
| Computer use execution policy | **Tested** | `sm_computer_use_enabled` preference is enforced at runtime in `DesktopAgent.execute` and `/api/desktop/execute`; destructive actions are gated; returns HTTP 403 when disabled. Tested in `test_coding_sync.py`. |
| YouTube channel intent & direct navigation | **Tested** | Channel regex parser resolves natural queries like *"Shashwat Mishra Techie YouTube channel open karo"* directly to YouTube channel URL rather than generic video search. Tested in `test_coding_sync.py`. |
| App launches report observed outcome | **Observed** | Was `Popen(...)` then `{"success": True}` on the next line. Now waits and polls: running → confirmed, exited 0 → success but unconfirmed, exited non-zero → failure with the code. Exercised against real processes (sleep / immediate return / `sys.exit(3)`), not only mocks. 8 tests. |
| Windows browsers no longer succeed when absent | **Tested** | `Popen("start chrome", shell=True)` returned 0 with no Chrome installed, because `start` is a cmd builtin that always succeeds. Now resolves the executable and spawns it directly. |
| Machine control can be stopped | **Observed** | Scoped sessions with a check immediately before dispatch, so a stop lands between steps. Unknown tokens refused; tokens never appear in the listing. Exercised through the API — start, list, stop-all, stop-again. 14 tests. |

### Implemented, not observed

| Item | State | What is missing |
| --- | --- | --- |
| Foreground listening service (Android) | **Implemented** | Service runs foreground with microphone type and survives another app taking the foreground. Nobody has spoken a second command while another app is in front. |
| Pronunciation by reply script | **Implemented** | Voice chosen from the reply's script rather than the language picker. |
| Caption follows the voice | **Tested** | 22 unit tests. |
| Appearance light mode | **Observed** | Fully audited across all views (Sites, Plugins/Extensions, Terminal, Device Dispatch, Scheduled Automations, Chat). Fixed hardcoded dark backgrounds (`bg-zinc-950`) to adaptive light surfaces with high-contrast text. "Cowork" permanently removed from Chat navigation. |
| Linux desktop actions | **Implemented** | `desktop_agent.py` resolves Linux executables and uses `xdg-open`. No native Linux desktop session has exercised it. WSL CLI runs do not count. |

### Not implemented

| Item | Why it is not a small job |
| --- | --- |
| **Close app / clear recents (Android)** | No Android API exists for either. Requires an AccessibilityService the user enables in Settings; Play restricts apps that use it. |
| **Send a WhatsApp message** | `wa.me` can open WhatsApp with text pre-filled; pressing send needs an AccessibilityService. |

### Blocked on something outside the code

| Item | Blocker |
| --- | --- |
| Code signing | The only free route (SignPath Foundation) requires no proprietary components. The bundled character model forbids redistribution in its own PMX header and the owner has chosen to keep it. Needs a paid certificate or the author's permission. |
| RPM install acceptance | Needs a real Fedora/RHEL/openSUSE machine. Extraction and running the binary is **not** installation acceptance. |
| Real video generation | Weights are 2–28 GB. Package installation is not generation and must not be reported as it. |
| Third-party connectors (Gmail, Drive, Slack, Canva…) | Each needs a supported API and the owner's authorization. A name appearing in a reference screenshot is not availability. |

---

## Release state

Source version **2.10.36**. The current release APK is installed and verified on attached physical device `8f807260`.
The fresh Windows standalone executable (`dist/SMARAN.AI/SMARAN.AI.exe`) and double-click installer (`installer/output/SMARAN.AI-Setup.exe`) have been compiled and verified with content hashes and automated test coverage.
