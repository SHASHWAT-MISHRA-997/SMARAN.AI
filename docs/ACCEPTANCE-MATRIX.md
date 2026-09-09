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

## Evidence run — 2026-09-10

All numbers below were produced in this session, not quoted from earlier logs.

| Suite | Result |
| --- | --- |
| `pytest backend/tests cli/tests` | **340 passed**, 12 warnings, 55.10s |
| `npm run test:unit` (frontend) | **145 passed** |
| `npx oxlint src/` | clean |
| `npm run build` (frontend) | clean |
| VS Code extension `npm test` | **23 passed, 1 skipped** |
| Playwright `mobile-reply-voice.spec.js` | **12 passed** (see note) |

**Note on the browser suite.** One WebKit case — "mobile handset ends the call
instead of only pausing the microphone" — failed once during a full run, then
passed both in isolation (4/4) and on a repeat full run (12/12). Recorded as
intermittent rather than rerun until green. It is not currently a confirmed
fault and it is not currently trustworthy either.

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
| App launches report observed outcome | **Observed** | Was `Popen(...)` then `{"success": True}` on the next line. Now waits and polls: running → confirmed, exited 0 → success but unconfirmed, exited non-zero → failure with the code. Exercised against real processes (sleep / immediate return / `sys.exit(3)`), not only mocks. 8 tests. |
| Windows browsers no longer succeed when absent | **Tested** | `Popen("start chrome", shell=True)` returned 0 with no Chrome installed, because `start` is a cmd builtin that always succeeds. Now resolves the executable and spawns it directly. |

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
| **Public chat sharing (Copy link)** | Needs hosting: a server storing immutable snapshots, opaque ids, read-only rendering, revocation, size limits. Cannot work from localhost on another device. Needs a deployment decision and owner approval. The local copy/download is not this and is not labelled as this. |
| **Full computer-use loop** | An observe → decide → act → verify loop with Windows and Linux adapters, X11/Wayland honesty, session scoping and a stop control. What exists is a launcher, not computer use. |
| **Settings sections 1–13** | General, Profile, Appearance (partial), Voice, Personalization, Keyboard shortcuts, Analytics, Plugins/Skills/MCP, Browser, Computer use, Connections, Git, Environments. Only Appearance has landed. |
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
