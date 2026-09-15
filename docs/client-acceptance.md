# Client acceptance status

Updated 15 September 2026. This records verified scope, not a promise of zero defects.
The supplied engineering handoff is not fully accepted yet.

| Requirement | Status and evidence |
|---|---|
| Backend regression suite | 712 passed, 1 skipped; 13 warnings. `.cache/audit/voice-reply-backend-unrestricted.log` |
| Frontend regression suite | 189 passed. `.cache/audit/voice-reply-frontend-final.log` |
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
| Connectors, telemetry, PIN/auth | Full real integration acceptance pending. Do not change credentials or security configuration to pass tests. |
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
