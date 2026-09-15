# Client acceptance status

Updated 16 September 2026. This records verified scope, not a promise of zero defects.
The supplied engineering handoff is not fully accepted yet.

| Requirement | Status and evidence |
|---|---|
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
