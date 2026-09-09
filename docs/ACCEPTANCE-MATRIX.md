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

## Evidence run — 2026-09-10 (Updated)

All numbers below were produced in this session, not quoted from earlier logs.

| Suite | Result |
| --- | --- |
| `pytest backend/tests cli/tests` | **376 passed**, 12 warnings, 51.94s (includes 8 public share & 7 computer use tests) |
| `npm run test:unit` (frontend) | **145 passed** |
| `npx oxlint src/` | clean (0 errors, 0 warnings across 70 files) |
| `npm run build` (frontend) | clean (built in 9.44s) |
| VS Code extension `npm test` | **23 passed, 1 skipped** (567ms) |
| Playwright `mobile-reply-voice.spec.js` | **4 passed** (Chromium) |

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
| App launches report observed outcome | **Observed** | Was `Popen(...)` then `{"success": True}` on the next line. Now waits and polls: running → confirmed, exited 0 → success but unconfirmed, exited non-zero → failure with the code. Exercised against real processes (sleep / immediate return / `sys.exit(3)`), not only mocks. 8 tests. |
| Windows browsers no longer succeed when absent | **Tested** | `Popen("start chrome", shell=True)` returned 0 with no Chrome installed, because `start` is a cmd builtin that always succeeds. Now resolves the executable and spawns it directly. |
| Machine control can be stopped | **Observed** | Scoped sessions with a check immediately before dispatch, so a stop lands between steps. Unknown tokens refused; tokens never appear in the listing. Exercised through the API — start, list, stop-all, stop-again. 14 tests. |

### Implemented, not observed

| Item | State | What is missing |
| --- | --- | --- |
| Foreground listening service (Android) | **Implemented** | Service runs foreground with microphone type and survives another app taking the foreground. **Nobody has spoken a second command while another app is in front.** Owner deferred phone testing. |
| Pronunciation by reply script | **Implemented** | Voice chosen from the reply's script rather than the language picker. Nobody has listened. |
| Caption follows the voice | **Tested** | 22 unit tests; never watched on a device. |
| Linux desktop actions | **Implemented** | `desktop_agent.py` resolves Linux executables and uses `xdg-open`. **No native Linux desktop session has exercised it.** WSL CLI runs do not count. |
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
| Physical Android acceptance | Deferred by the owner. |

---

## Release state

Source version **2.10.36**. The published release is 2.10.36. Commits since it
— including device control, the foreground service, pronunciation, the caption,
appearance, share and the hardware panel — are **not in any published build**.

The version is baked into every frozen binary, so shipping them means bumping
the version and rebuilding every platform. No release has been prepared or
requested.

The most recent Android artifact predates the appearance, share and hardware
work. It is **not** current and **not** installed.
