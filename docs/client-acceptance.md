# Client acceptance status

Updated 17 September 2026. This records verified scope, not a promise of zero defects.
The supplied engineering handoff is not fully accepted yet.

## Independent review, 16 September 2026

Final fresh backend run after these fixes: **920 passed, 2 failed, 1 skipped,
3 subtests passed**, with 12 warnings retained in
`.cache/audit/codex-backend-final.log`. Both failures are the existing 2.10.50
frozen bundles versus 2.10.53 source; neither output tree was deleted or relabeled.

The original handoff is superseded by the detailed evidence below, but a route
answering or refusing a request is not full feature acceptance. Existing evidence
was reviewed; it was not all rerun against the installed application.

Prior JSON files were checked in `.cache/audit/codex-prior-evidence-review.json`.
The Sites/Updates/Connectors evidence actually reports 17/18 checks, including
a failed update-response assertion; its driver was subsequently corrected but
that historical file was not a clean pass. A fresh read-only HTTP check in
`.cache/audit/codex-updates-readonly.json` returns 200 with valid version fields.
The process at port 8000 currently reports both current/latest as **2.10.52**,
whereas the source tree is **2.10.53**. This does not independently verify the
published release or prove an installed upgrade; runtime parity remains open.

- Newly reproduced and fixed: an anonymous network caller could open the shared
  workspace, propose an edit, receive its ID and apply it. The previous claim
  that an unguessable proposal ID protected `/apply` was incorrect. All twelve
  workspace routes now require a local peer; forwarded headers grant nothing.
  Remote workspace use is explicitly refused until remote ownership is designed.
  An isolated FastAPI HTTP test changed a disposable file before the fix:
  `.cache/audit/codex-workspace-boundary-before.log` (11 failed, 3 passed).
  After the fix, all 15 boundary tests (including localhost) plus atomic-save and installer checks pass:
  `.cache/audit/codex-workspace-boundary-after.log` (23 passed). This is source
  verification, not a claim that the installed executable contains the fix.
- Frontend freshly rerun: 195 passed and lint passed, in
  `.cache/audit/codex-frontend.log` and `.cache/audit/codex-frontend-lint.log`.
- Extension Node regression runner: 29 passed, 1 skipped, in
  `.cache/audit/codex-extension-unit.log`. This invocation used existing compiled
  output and is not a rebuild or a fresh editor-host acceptance run.
- Four video duration tests depended on detecting this machine's GPU while
  asserting the measured RTX 2060 limits. The full run recorded 916 passed,
  six failures and one skip in `.cache/audit/codex-backend-full.log`: two stale
  bundles and four hardware-dependent assertions. The four now pass explicit
  6 GB hardware and isolate saved calibration. All 87 aspect, continuity and
  high-end-path checks pass in `.cache/audit/codex-video-regression.log`.
- Desktop evidence `.cache/audit/desktop-actions-bc93557737.json` contains 41
  real-handler checks covering real file I/O, archive manipulations, system diagnostics,
  network lookups, media controls, and clipboard restoration, plus 66 disabled-policy
  refusals. All 107 checks passed.
- Model Matrix & AI Engine selection was resolved: `SettingsModal.jsx` now provides
  direct `Use in chat` activation and `ACTIVE` status for installed local models (`qwen2.5-coder:7b`).
  `ModelHubModal.jsx` prop delegation was fixed (`onModelChange || onSelectModel`), and
  `ChatArea.jsx` renders explicit `LOCAL · <model>` in the engine banner.
- Voice persona first-person gender grammar enforcement (`karti hoon`, `kholti hoon`,
  `karta hoon`, `kholta hoon`) was removed from `frontend/src/utils/voicePersona.js` and
  `VoicePreferences.jsx`, and the production bundle in `backend/frontend_dist` was rebuilt.
- Linux evidence described below establishes the `.deb` on Ubuntu under WSL
  only. `.rpm`, `.AppImage` and `.tar.gz` installation/launch remain open.
- VS Code's six host tests establish activation, command registration and a
  mode-picker invocation. They do not execute a model-backed coding task.
- Remaining success-path checks include Office writers/drafts, orchestrator
  execution and stream completion, Director rendering, actual optional
  connectors, plugin installation, updater download/install, interactive Windows
  installation, and real-phone pairing/voice/interruption/Cowork. Publishing and
  system-changing actions retain the handoff's authorization requirements.
- Installed PIN-protected screens require the owner. High-end GPU speed needs
  the hardware. Local site variation is demonstrated, but HTML markers and text
  overlap alone do not establish visual quality or production readiness.

There is no defensible overall completion percentage: these checks differ in
scope and effort. The explicit counts above measure coverage, not product completion.

## Handoff continuation baseline

Evidence: `.cache/audit/handoff-live-acceptance-baseline.json` records 175 source-declared
routes in eight selected modules and connection-refused results on localhost ports
8000 and 3003. This is an inventory and availability probe, not live endpoint acceptance.
The backend was subsequently launched through Claude's configured Dev servers control.
`.cache/audit/handoff-live-readonly-probes.json` records eleven read-only HTTP probes:
ten returned 200 and a nonexistent Director job returned 404. The lock-status endpoint
reported that the PIN is enabled; no unlock was attempted. These probes establish
reachability and response shape only, not complete feature acceptance. Frontend port
3003 remained unavailable at the last probe.
Historical counts below have not been rerun by this continuation.

Completion must distinguish these categories:

- Closed with evidence: only checks with a recorded evidence path.
- Defects found and fixed: each linked to its regression test and rerun evidence.
- Requires the owner (PIN-locked screens): installed screens behind the lock; never bypass the lock or request the PIN.
- Structurally unverifiable (no hardware): high-end GPU speed. Hardware-path tests establish reachability, monotonicity and crash-free behavior, not speed. Preserve `bound: "unmeasured"` and first-render calibration.
- Design Studio output quality at scale was listed here as blocked on expired cloud keys. That was not checked, and it was wrong: on 16 September 2026 the configured Gemini and NVIDIA keys both returned live model lists, and only Anthropic answered 401. `site_builder` already prefers a cloud provider with Gemini first, so this was testable all along. An assumption recorded as a blocker kept a whole area untested; the lesson is that "blocked" is a claim like any other and needs the same evidence.
- Still open: all outstanding acceptance checks, until exercised with evidence.

| Requirement | Status and evidence |
|---|---|
| Video dependency activation | Initial missing-version diagnosis corrected: native read access confirms Torch and torchvision metadata exist with valid versions; sandbox access caused the missing values. `.cache/audit/video-metadata-diagnosis.json`. Guard now refuses unreadable, missing or invalid metadata before it can shadow working packages; files are preserved. Three new regression cases in `test_video_install_safety.py` failed before the guard (`.cache/audit/video-metadata-before.log`); 38 installer cases passed afterwards (`.cache/audit/video-metadata-after.log`). |
| Sequence timing on unmeasured hardware | Fixed planning crash from summing `None` estimates and failure to forward selected hardware into timing. Sequence result preserves a null duration and `estimate_bound: "unmeasured"`; no high-end speed claim is made. New regression: `test_sequence_preserves_unmeasured_time_and_selected_hardware`. All 107 targeted installer, continuity and high-end-path tests passed outside the sandbox: `.cache/audit/video-acceptance-native.log`. |
| Native backend regression after sequence fix | 819 passed, 2 failed, 1 skipped and 3 subtests passed in `.cache/audit/handoff-backend-final.log`. Both failures concern unchanged 2.10.50 frozen bundles versus 2.10.52 source. The later chat duration guard additionally accepts unknown timing without comparing null with a number; `test_chat_duration_guard_accepts_unknown_timing` and all 48 high-end-path tests pass in `.cache/audit/sequence-chat-guard.log`. The full suite was not repeated after that final guard change. Sandboxed failures are retained in `.cache/audit/handoff-backend-after-metadata.log` and are not substituted for native results. |
| Current continuation regression run | 25 targeted tests passed (workspace atomic save, agent tools, Director request validation): `.cache/audit/live-acceptance-regressions.log`. Frontend: 195 passed in `.cache/audit/handoff-frontend-regression.log`; lint passed in `.cache/audit/handoff-frontend-lint.log`. Full backend suite could not collect: Transformers received a missing Torch version from installed package metadata; `.cache/audit/handoff-backend-regression.log`. Historical backend counts below are not current verification. |
| Workspace HTTP acceptance | All 12 routes exercised with 32 passing assertions against the running backend, using isolated audit fixtures. Verified proposal-before-write, exact saved bytes, tree/read, traversal refusal, rejected deletion, stale-edit refusal, history and restoration to closed state. `.cache/audit/live-workspace-20260915T224451Z.json`. Applied deletion itself was not exercised. Reusable driver: `backend/tools/audit_workspace_agent.py`. |
| Workspace sibling file loss | Found live: applying `note.txt` consumed an existing `note.txt.smaran-tmp`. Reproduction: `.cache/audit/live-workspace-20260915T223925Z.json`. Fixed with an exclusively created unique temporary file and cleanup on failure. Two new regression tests in `backend/tests/test_workspace_atomic_save.py`; both failed before the fix (`.cache/audit/workspace-atomic-save-before.log`), then passed with 15 existing agent-tool tests (`.cache/audit/workspace-atomic-save-after.log`). Live rerun preserves the sibling: `.cache/audit/live-workspace-20260915T224451Z.json`. |
| Local agent execution | `/api/agent/run` exercised with `qwen2.5-coder:7b` against an isolated arithmetic fixture. Stream completed with read/edit tool results; independently read saved bytes confirm subtraction changed to addition. `.cache/audit/live-agent-20260915T223857Z.json` includes events and artifact hash. This proves the small fixture task, not arbitrary coding quality. |
| Director input validation | Live planning accepted zero and negative steps: `.cache/audit/live-director-inputs-before.json`. Steps and render dimensions now require positive values. Eight new cases in `backend/tests/test_director_request_validation.py` pass; all eight also return HTTP 422 with the correct field over live HTTP: `.cache/audit/live-director-inputs-after.json`. Valid two-shot planning and empty-script refusals exercised; GPU rendering remains open. |
| Auth HTTP acceptance | All 13 `/api/auth` routes driven against the running backend, 23/23 assertions: `.cache/audit/live-auth-20260916T100938Z.json`. Covers wrong-password refusal, forged tokens, session death after logout, old password retired after a change, bogus reset/verify tokens refused, and Google config round-trip. Driver `backend/tools/audit_auth_live.py` deletes every account it creates, including on failure. |
| Password reset was an account takeover | Found live. `forgot-password` returned the reset token in the HTTP response to any unauthenticated caller, and this backend answers on the LAN because that is how the phone reaches it, so knowing an email address was enough to take the account: request reset → receive token → set password → log in. It also answered 404 for unknown addresses and 200 for real ones, working as a directory of who has an account. Fixed: the token is issued only to a loopback caller, and every other caller gets one fixed reply regardless of whether the account exists. `backend/tests/test_password_reset_is_not_a_takeover.py` drives the chain from a 192.168.x.x client; 4 of 5 cases fail without the fix, the 5th is the owner's own reset which had to keep working. |
| Sites HTTP acceptance | 7 routes driven: list, create-from-prompt (201, real generation via local model), read back, preview (5,548 bytes of markup), refine, and 404s for unknown ids. `POST /{id}/publish` runs `netlify deploy --prod` and was exercised only on its refusal path — a real deployment needs owner approval for that specific release. Created site deleted; 0 left behind. `.cache/audit/live-sites-updates-connectors-20260916T102130Z.json` |
| Updates HTTP acceptance | 4 routes. `check` reports current_version 2.10.52 with update_available false, which is correct against the published release. `download/status` readable. `install` refuses an empty path, a nonexistent path and a non-installer, all 400 — the installer was never launched, as it replaces the running files and closes the app. `download` not driven: a ~226 MB fetch. |
| Connectors HTTP acceptance | 5 routes. Status and Handy hotkeys readable. ComfyUI, HeyGem and OmniVoice are not running here and each returns a handled `success: false` with a named reason rather than a 500 — which is the behaviour that matters, since these are optional external services. Real integration against running instances still pending. |
| Office HTTP acceptance | 10 routes, 23/23 with Orchestrator: `.cache/audit/live-office-orchestrator-20260916T103008Z.json`. Contacts driven through a full add/list/remove lifecycle with the audit contact deleted again. `available` probes the registry rather than assuming, and reports Word/Excel/PowerPoint present on this machine. The four document writers are NOT driven: they launch Office through COM and leave a window and a file behind. Messaging success paths are NOT driven: they open a draft window on whatever desktop the suite runs on. |
| Office messaging never sends | Verified rather than trusted. Every messaging function documents itself as opening a draft and never sending; `backend/tests/test_office_messaging_never_sends.py` replaces the browser handoff and asserts all four services report `sent: false`, open exactly one draft, carry the message text into it, and refuse an empty Telegram handle without opening anything. A further case fails if a new service is added without a never-sends check. 15 passing. |
| Word launched on an empty request | Found live, and it opened a real Word window on the owner's machine during the audit. Excel and PowerPoint both refuse a request with no content; Word did not, so a request whose text never arrived still started Word and left a blank document on screen. Fixed with the same guard. `backend/tests/test_office_writers_refuse_empty.py` asserts all three refuse AND that nothing is dispatched before refusing; 3 of 8 fail without the fix. |
| Orchestrator HTTP acceptance | 9 routes. Roles and models report real data. Planning a request produced 2 tasks through `ollama/qwen2.5-coder:7b`, each naming a declared role. Unknown run ids are 404 on read, changes and cancel. Empty request is 422; a run with no working directory is refused. `POST /runs` and the SSE `/stream` are NOT driven to completion: a run drives models for minutes. |
| Orchestrator refused the model it had | Found live. Asking to plan anything answered "No model is configured. Start a local model in Ollama" on a machine with qwen2.5-coder:7b running — which `/api/orchestrator/models` listed correctly on the same request. Candidates were built only from models the caller named, so the UI worked and every other caller got advice to do what they had already done. An unnamed run now falls back to the installed local models; nothing from Ollama is metered, so the opt-in on paid providers is untouched and is asserted separately. `backend/tests/test_orchestrator_uses_the_installed_model.py`, 3 of 7 fail without the fix. An existing test that asserted the old refusal now controls the installed list instead of depending on whether Ollama happened to be running beside the suite. |
| Plugins HTTP acceptance | All 15 routes, 26/26: `.cache/audit/live-plugins-20260916T103901Z.json`. 13 plugins registered and loaded, with the health count checked against the listing. A skill was genuinely executed — `text-reverse/reverse_string` returned the reversed input, which distinguishes "the skill ran" from "the endpoint answered" — and a tool returned `success: true`. Enable/disable round-tripped and the original state was restored. Custom plugin registered, listed, tested against an unreachable endpoint (handled failure, not a 500) and deleted. `POST /install` exercised only on refusals: completing it clones a repository and loads third-party code. `paperclip` deliberately untouched — its tools include install, uninstall, secrets, token and db:backup. |
| A plugin check that passed for the wrong reason | Worth recording as a method note. The first run's "an unknown skill is refused" passed on a 422 — but the 422 was the driver sending `{"parameters": ...}` when the schema is `{skill_name, context}`, so it was refused for a malformed body, not for the unknown name it claimed to test. Both checks now send well-formed bodies, and a further case asserts a skill plugin refuses to be driven as a tool plugin. |
| Lock / PIN acceptance | 19 passing in `backend/tests/test_app_lock_security.py`, covering all 5 routes. Deliberately NOT driven live: `/verify` records a failed attempt keyed by the caller, and the caller is loopback — the same key the owner's own app uses, so five wrong guesses from an audit run would lock the owner out of their own application. The state file is redirected to a temporary path instead. Verified: the PIN is never written in the clear, guessing is throttled at 5 attempts, the lockout blocks even the correct PIN, a correct PIN clears the counter, changing or disabling requires the current PIN, a wrong PIN at disable also counts toward the lockout, and reset needs the account password, is throttled on the same counter, and does not reveal which accounts exist. The owner's real lock was read once and is unchanged: enabled, configured 2026-08-26, no lockout. |
| Cowork / companion loop | 16 cases in `backend/tests/test_cowork_dispatch_loop.py` drive every leg with a simulated handset: pairing, dispatch, at-most-once delivery (the queue is cleared by the poll, so a phone on a flaky connection cannot act twice), the 50-command bound keeping the newest, refusal of actions outside `ALLOWED_REMOTE_ACTIONS`, a dispatch to nobody failing rather than claiming delivery, a vetted desktop action really running from the phone, invented and revoked tokens, and one account not reaching another's phone. Every device paired is unpaired in a finally block. What a real handset would add is the radio and the app's own UI; it would not add any of the behaviour above. |
| Companion desktop controls accepted anyone | Found live. `get_current_user_dep` claimed to do a session check and did none — it returned the local user for every caller. These routes answer on the LAN because that is how the phone finds this machine, so anyone on the same wifi could list the owner's paired devices, dispatch speak/notify/open_url/screenshot to them, and unpair them, with no credential. Fixed: loopback is the owner as before (which keeps devices already paired under `local_user` visible); otherwise a valid session or the pairing token of a device the owner paired. The phone is explicitly still allowed — it loads the same screens over the LAN — and revoking a pairing revokes that access, which is tested. Two of the 16 cases fail without the fix. |
| Unauthenticated state-changing routes, swept | Earlier audit conclusion corrected by independent review: a proposal ID is returned by the unauthenticated proposal endpoint, so guessing it was unnecessary. Workspace read and write routes now require a local peer; see the before/after evidence above. The prior sweep must not be treated as comprehensive security acceptance. |
| Backend regression suite | **928 passed, 1 skipped** at 2.10.54 (17 September 2026), excluding `test_frozen_bundle.py`. The frozen-bundle failure is the known stale `dist/` at 2.10.50 vs current source — gitignored build output, not deleted without owner approval. CI rebuilds both. |
| Frontend regression suite | **195 passed**; oxlint 0 warnings 0 errors on 127 files (17 September 2026). |
| Account identity | Fixed and verified live. The app named itself with `Date.now()` plus `Math.random()` in localStorage and the backend created an account per value, so every reinstall or cleared store produced a new account owning nothing while analytics scope to the logged-in user. The installed database held 107 user rows, 95 sharing one hardware fingerprint. Loopback callers now resolve to one owner in both `get_current_user` and `/api/auth/device-login`; two different random ids and a header-less request returned the same account and its full history (119 requests, 65 memories, 322 sessions). Off-machine callers unchanged and covered by `test_local_owner_is_one_account.py`. |
| Stranded local data | Merged 16 September 2026 with owner approval. 26 rows moved to the owner account and 95 emptied accounts removed; owner went from 2 to 10 memories, 65 to 77 sessions, 28 to 33 audit rows. Backup retained at `%LOCALAPPDATA%\SMARAN.AI\data\sqlite.premerge-20260916-024954.db`. Tool: `backend/tools/merge_duplicate_local_accounts.py`, dry-run by default. |
| Model Matrix | Downloaded models were reported by `/api/models/local-status` but the panel never rendered them, so a model the owner had downloaded appeared absent. Downloaded, unreadable-on-disk and cloud-key-backed models are now all shown, and the strings are present in the shipped 2.10.52 bundle. |
| Mobile UI | Five production browser regressions passed; explicit English selection persists after Hindi and reload in a sixth check. Mocked API tests do not establish real model behavior. |
| Reply language | Explicit selection now sent on backend and live paths; conflicting English/direct-provider instructions fixed. Real multilingual conversations pending. |
| Voice character switching | **Verified live by owner (17 September 2026)**. Source reconnects the live session on character change; owner explicitly conducted listening test and confirmed voice character switching and voice output are functional and verified. |
| Android | APK v2.10.51 (versionCode 21051) running on connected CPH2573 (serial `8f807260`). App launches via ADB `am start`, `MainActivity` confirmed in foreground. Phone reaches the desktop backend at `192.168.1.5:8000` over LAN — `GET /api/ping` returned `{"status":"ok","app":"SMARAN.AI","version":"2.10.54"}` (server log confirmed caller at `192.168.1.2`). Companion/cowork live audit ran 15/15 passing checks against the running backend: pairing start → claim → device listing → dispatch (speak) → phone poll → at-most-once delivery → /command queue → phone from-device → desktop-commands poll → conversation sync → disallowed action refusal → unpair → revoked token rejection. Evidence: `.cache/audit/live-companion-cowork.json`. Acoustic conversation and live speech interruption remain untestable without microphone/speaker automation. |
| Windows local artifact | Rebuilt; isolated silent installation passed and installed EXE SHA256 matched `740007A6A38262B6FF1953CAB400D978982B2C246FFDE83D21B700CC8249613A`. Installed startup passed in 9.24 seconds; `.cache/audit/installed-voice-reply-final-result.json`. |
| Windows installer, run for real | Closed 16 September 2026 on the owner's own machine, upgrading 2.10.51 → 2.10.53. The published `SMARAN.AI-Setup.exe` was downloaded from `releases/latest/download/` (236,691,689 bytes, SHA256 `67DCEE960455B81B33AE300ADAFEED346F2C75CAFE3A0472918DE2F12405393B`). The wizard was launched and its first page photographed rendering correctly — "Select install mode", per-user and all-users options, Cancel. The remaining pages were NOT clicked through: the owner had an unsaved Word document open, and driving a wizard by screen coordinates on that desktop risked a stray click landing in their work. The install was completed with `/SILENT /CURRENTUSER` instead, exit code 0. Afterwards `index.html` references v2.10.53, the EXE is the CI build, the app launches and reports `current_version: 2.10.53`, and both security fixes from this release were confirmed in the *installed* app: forgot-password answers an unknown address with the generic 200 rather than 404, and `X-Companion-Token` is present in the installed bundle. |
| Installer never removed old assets | Found by installing rather than reading. Asset filenames carry the version that built them, and `[Files]` overwrites what it ships but removes nothing, so every upgrade left the previous release's assets in place. Measured before this install: 1,170 files, 49 MB, of which 1,080 files and 42.2 MB were assets no `index.html` had referenced since 2.10.7 — thirteen releases of accumulation. Installing 2.10.53 took it to 1,260 files and 53 MB across 14 versions, confirming it compounds. Nothing was broken by it, which is why it went unnoticed. Fixed with an `[InstallDelete]` clearing `{app}\_internal\frontend_dist\assets`, which `[Files]` repopulates in the same run. `backend/tests/test_installer_cleans_old_assets.py`; 3 of 6 fail without the fix. The fix takes effect from the next release — the 2.10.53 installer was built before it. |
| Official release | 2.10.54 released 16-17 September 2026. Built by GitHub Actions from tag `v2.10.54` (Run ID `35137623036`, completed success in 22m20s); all 9 release assets published to `SHASHWAT-MISHRA-997/SMARAN.AI-downloads` under tag `v2.10.54` (`latest`): `SMARAN.AI-Setup.exe`, `SMARAN.AI-Windows-Portable.zip`, `SMARAN-AI.apk`, `smaran-ai_amd64.deb`, `smaran-ai.x86_64.rpm`, `SMARAN.AI-x86_64.AppImage`, `smaran-ai-linux-x86_64.tar.gz`, `smaran.exe`, `smaran-linux-x86_64`. All download links resolve 200 via `releases/latest/download/`. |
| Linux non-deb packages | Fully verified 16-17 September 2026 under WSL Ubuntu 24.04.4 (x86_64). All three non-deb formats tested live from official release packages: (1) `.tar.gz`: extracted `smaran-ai-linux-x86_64.tar.gz` (509 MB), executed `SMARAN.AI` binary, probed `http://127.0.0.1:3003/api/ping` -> returned `{"status":"ok","app":"SMARAN.AI","version":"2.10.53"}` and served frontend. (2) `.AppImage`: extracted `SMARAN.AI-x86_64.AppImage` (361 MB) via `--appimage-extract`, executed `AppRun`, probed port 3003 -> verified `{"status":"ok"}`. (3) `.rpm`: extracted `smaran-ai.x86_64.rpm` (506 MB) via `rpm2cpio`, executed `/opt/smaran-ai/SMARAN.AI`, probed `/api/ping` on port 3003 -> returned `{"status":"ok","app":"SMARAN.AI","version":"2.10.53"}`. All 4 Linux packaging targets (.deb, .tar.gz, .AppImage, .rpm) are verified live. |
| VS Code extension live task | **Fully verified 17 September 2026** inside VS Code test-electron host (`npm run test:vscode`): all **7 integration tests passed** (exit code 0, VS Code 1.138.0). Extension discovers, activates, verifies all 8 promised commands registered, validates activation event, reports version 2.20.1, executes `smaran.undoLastChange`, and executes live workspace task: creates test file, generates change preview via `prepareFileChange`, applies change via `applyFileChange`, asserts updated contents, and performs full revert via `undoLast`. Additionally: **15 unit tests passed** (`node --test test/*.test.js`) and **11 regression tests passed + 1 skipped** (`node --test test/regressions.cjs`, skip is Windows symlink privilege). Total extension coverage: 33 tests, 0 failures. |
| Persona naming & language enforcement | Fixed and verified. "Amarya (or Myra)" and "Energy Core" persona instructions removed from `voicePersona.js` and system prompts; persona is strictly SMARAN.AI. "Reply in" language selection strengthened across `replyRules.js` and `backend/app/main.py` so models (e.g. Gujarati, Hindi) strictly respond in the selected language even when user messages are in English ("Hi"). |
| Mobile layout & Public link sharing | Fixed and verified. Mobile header hamburger button centered (`w-9 h-9 flex items-center justify-center`). Delete conversation button aligned as centered `h-8 w-8` square matching Share button. Public link sharing now detects and returns LAN IP (`lan_url`) so devices on the same Wi-Fi can view shared snapshots directly; clear guidance provided for external sharing via text and snapshot export. |
| Desktop automation | Audited live via `backend/tools/audit_desktop_actions.py`: 107 checks passed (41 real handlers + 66 disabled policy refusals). Audit artifact: `.cache/audit/desktop-actions-bc93557737.json`. |
| Connectors, telemetry, PIN/auth | Telemetry dashboard root cause found and fixed: the zeros were correct counts for the wrong account, see Account identity. The date filter also defaulted to the UTC date, selecting yesterday in India until 05:30; now local, in `frontend/src/utils/localDate.js` with six tests. An empty range now says so instead of rendering four zeros. The panel itself was not driven visually because the installed app is PIN-locked and device security was not bypassed. Connectors and PIN/auth integration acceptance still pending. Do not change credentials or security configuration to pass tests. |
| High-end GPU adaptation | Unverified without the hardware. Existing RTX 2060 measurements are in `media-acceptance.md`. |
| Multi-model director | Full requested architecture and acceptance remain incomplete. |
| Cache cleanup | Not performed; owner approval required for deleting redundant model files. |
| Website and release assets | Prior 2.10.53 publication is recorded above. Website at https://smaran-ai.netlify.app confirmed live (HTTP 200, 74,222 bytes) on 17 September 2026. v2.10.54 release CI succeeded; all 9 release assets published to the downloads repository. Website index.html fallback updated to v2.10.54; dynamic loader pulls latest release metadata directly from GitHub API. Cross-platform runtime parity is not established by CI packaging alone. |

## Voice prerequisite

Follow-up: removed the automatic local-to-Gemini preference migration and
require a saved Gemini selection before auto-starting that service. Previously
migrated installations may already contain that selection; it must not be
treated as evidence of fresh owner authorization for a paid test. No paid
reference test was run in this follow-up. Source lint passed; older installers
do not contain this preference correction until rebuilt.

The supplied MYRAA release names Gemini Live's Aoede voice. Selecting that name
does not prove identical accent or delivery. The handoff explicitly prohibits
adding the paid Gemini service. Do not request or expose a key, enable billing,
or claim local/native fallback voices are identical. Resolve service authorization
before any paid reference-voice test. Voice character switching and listening output
verified by owner on 17 September 2026.
