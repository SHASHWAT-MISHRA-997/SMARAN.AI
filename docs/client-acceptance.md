# Client acceptance status

Updated 16 September 2026. This records verified scope, not a promise of zero defects.
The supplied engineering handoff is not fully accepted yet.

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
- Structurally unverifiable (no hardware / no paid keys): high-end GPU speed and Design Studio output quality at scale. Hardware-path tests establish reachability, monotonicity and crash-free behavior, not speed. Preserve `bound: "unmeasured"` and first-render calibration. Expired cloud keys do not authorize adding a paid service.
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
| Backend regression suite | 805 passed, 1 skipped, 3 subtests, at 2.10.52. Two failures remain in `test_frozen_bundle.py`: the local `dist/` and `build-linux/` trees are stale at 2.10.50 and are gitignored build output, not deleted without owner approval. CI rebuilds both. |
| Frontend regression suite | 195 passed; oxlint clean. |
| Account identity | Fixed and verified live. The app named itself with `Date.now()` plus `Math.random()` in localStorage and the backend created an account per value, so every reinstall or cleared store produced a new account owning nothing while analytics scope to the logged-in user. The installed database held 107 user rows, 95 sharing one hardware fingerprint. Loopback callers now resolve to one owner in both `get_current_user` and `/api/auth/device-login`; two different random ids and a header-less request returned the same account and its full history (119 requests, 65 memories, 322 sessions). Off-machine callers unchanged and covered by `test_local_owner_is_one_account.py`. |
| Stranded local data | Merged 16 September 2026 with owner approval. 26 rows moved to the owner account and 95 emptied accounts removed; owner went from 2 to 10 memories, 65 to 77 sessions, 28 to 33 audit rows. Backup retained at `%LOCALAPPDATA%\SMARAN.AI\data\sqlite.premerge-20260916-024954.db`. Tool: `backend/tools/merge_duplicate_local_accounts.py`, dry-run by default. |
| Model Matrix | Downloaded models were reported by `/api/models/local-status` but the panel never rendered them, so a model the owner had downloaded appeared absent. Downloaded, unreadable-on-disk and cloud-key-backed models are now all shown, and the strings are present in the shipped 2.10.52 bundle. |
| Mobile UI | Five production browser regressions passed; explicit English selection persists after Hindi and reload in a sixth check. Mocked API tests do not establish real model behavior. |
| Reply language | Explicit selection now sent on backend and live paths; conflicting English/direct-provider instructions fixed. Real multilingual conversations pending. |
| Voice character switching | Source reconnects the live session on character change. Audible gender and reference accent matching remain unverified. |
| Android | Latest APK installed and launched on connected CPH2573. Acoustic conversation, pairing and interruption acceptance pending. |
| Windows local artifact | Rebuilt; isolated silent installation passed and installed EXE SHA256 matched `740007A6A38262B6FF1953CAB400D978982B2C246FFDE83D21B700CC8249613A`. Installed startup passed in 9.24 seconds; `.cache/audit/installed-voice-reply-final-result.json`. |
| Official release | Pending owner approval and GitHub Actions provenance. Local builds are audit artifacts, not official releases. |
| Linux | Earlier packages verified under WSL; later voice/reply changes require another build. Actual distribution testing pending. |
| Design Studio / Sites | UI checks are insufficient to establish real generated output quality or variation. Real generation acceptance pending. |
| Desktop automation | Exhaustive end-to-end coverage of 67 actions pending. |
| VS Code extension | Unit tests do not establish operation inside VS Code with a live backend. Live integration pending. |
| Connectors, telemetry, PIN/auth | Telemetry dashboard root cause found and fixed: the zeros were correct counts for the wrong account, see Account identity. The date filter also defaulted to the UTC date, selecting yesterday in India until 05:30; now local, in `frontend/src/utils/localDate.js` with six tests. An empty range now says so instead of rendering four zeros. The panel itself was not driven visually because the installed app is PIN-locked and device security was not bypassed. Connectors and PIN/auth integration acceptance still pending. Do not change credentials or security configuration to pass tests. |
| High-end GPU adaptation | Unverified without the hardware. Existing RTX 2060 measurements are in `media-acceptance.md`. |
| Multi-model director | Full requested architecture and acceptance remain incomplete. |
| Cache cleanup | Not performed; owner approval required for deleting redundant model files. |
| Website and release assets | No new publication approved or performed. Windows portable, CLI, extension and Linux release parity must be checked in CI. |

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
before any paid reference-voice test. EnergyCore is configured for Orus, but its
actual output is not yet accepted by listening.
