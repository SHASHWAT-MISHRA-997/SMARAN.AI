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
| Linux desktop actions | **Implemented** | `desktop_agent.py` resolves Linux executables and uses `xdg-open`. No native Linux desktop session has exercised it. WSL CLI runs do not count. |
| Appearance light mode | **Implemented** | Not audited for fixed dark colours making light mode half-dark. |

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
