# Claude takeover prompt — SMARAN.AI

Copy everything below this line into Claude Code. It is a takeover request, not a planning request.

---

You are taking over a live, local-first AI assistant named **SMARAN.AI**. Work only inside:

`C:\Users\shash\Desktop\SMARAN.AI`

The owner has authorized implementation, local builds, device testing, installer packaging, and the already-approved Netlify production deployments. Your job is to complete the work, verify it with real evidence, and update the project. Do not merely review, describe a plan, or claim that something works without executing it.

## Non-negotiable operating rules

1. Preserve all existing user and agent work. Start with `git status --short`, `git diff --stat`, and a targeted diff review. The worktree is intentionally dirty. Do **not** run `git reset`, `git clean`, checkout/revert files, stash changes, wholesale reformat, or delete application/user data.
2. Do not put API keys, tokens, PINs, credentials, or private URLs into source, APKs, websites, logs, test fixtures, commits, chat output, or client bundles. The prior OpenRouter key supplied in chat must be treated as compromised: do not reuse it and tell the owner to rotate it after local configuration is repaired.
3. No fake integrations. A visible card labelled Connected/Active/Installed must correspond to a persisted configuration and a successful real probe or real execution. A custom skill must remain a Draft until its executable implementation exists. A connector must show its authentication/error state truthfully.
4. Never turn a missing external credential, unavailable service, unsupported phone API, rate limit, or failed install into a false success. Give a useful action and a precise error state instead.
5. Fix root causes and add focused regression tests. Avoid hard-coded success states, long blocking work on request threads, silent fallbacks, and simulated progress.
6. Test source code before packaging; test the packaged artifact separately. Re-run only the relevant checks after a fix, then update the verification document with exact commands, results, dates, artifact hashes, and known limitations.
7. Use the existing app design and local-first privacy model. Do not introduce paid subscriptions, credits, forced cloud use, or public telemetry. Free/open-source functionality is acceptable only when its licence and runtime requirements are real.

## Current verified baseline (do not repeat work blindly)

The repository already contains substantial uncommitted fixes. Audit them before changing overlapping code.

### Recent successful checks

- Backend: `python -m pytest backend/tests -q` passed **97** tests.
- Frontend: `npm run lint` passed with no lint findings.
- Frontend unit tests: `npm run test:unit` passed **31** tests. The Node experimental VM Modules notice comes from the test runner, not the product.
- Frontend production build completed after the recent mobile and Energy Core changes.
- Playwright: `frontend/tests/visual/phone-controls.spec.js` passed **3** tests; `frontend/tests/visual/extensions-truth.spec.js` passed **2** tests after its timeout was corrected.
- VS Code extension: `npm test` in `vscode-extension` passed **22**, with **1 Windows symlink-permission skip**. Do not hide or reclassify this skip.
- Android release build succeeded: version **2.10.34**. Latest APK path is `frontend/android/app/build/outputs/apk/release/app-release.apk`.
- The APK was credential-scanned: 552 entries, no configured provider secret findings. Last SHA-256 was `723c8abaf113cb37ad8e4afc72c685c2f3bee89903f638fe7ee49205edeafdd4`; recalculate after any rebuild.
- A real Android device is available through `C:\Asdk\platform-tools\adb.exe`, serial `8f807260`, model CPH2573, Android 16. It may require the owner to unlock the correct Android/System Cloner profile and accept USB debugging. Do not ask for PINs in chat.
- Runtime plugin probe `python tools/verify_runtime_plugins.py` passed: headroom, code-risk-scan, task-observer, provider-latency, meeting-notes-import, and hyperframes.
- A real filesystem MCP server was started, listed 14 tools, then used through SMARAN to write/read a proof file. A GitHub connector also successfully read public repository information. Paperclip and Google Agents CLI `--help` were executed through their plugin paths.
- The local neural TTS endpoint produced a real MP3 (`edge-neural`) using an Indian male voice configuration. The artifact is `.cache/audit/energy-core-indian-male.mp3`.

Read existing proof and logs in `.cache/audit/` and `docs/VERIFICATION-2026-09-08-CURRENT.md`, but do not rely on stale evidence after touching relevant code.

### Recent implementations that require audit, not replacement

- `frontend/src/components/ExtensionsHub.jsx` now aims to remove fake active custom MCP/skill states and uses authenticated fetches.
- `backend/app/mcp/manager.py` caches reports per session and clears broken sessions.
- `backend/app/plugins/headroom.py`, `paperclip.py`, and `google_agents_cli.py` moved expensive/subprocess work off request handling. Paperclip parses real command names. **Google Agents CLI still has a hard-coded tool list in part of its implementation; replace it with help/version-derived or otherwise real command discovery and test it.**
- `backend/app/main.py` has WebSocket disconnect handling and an Energy Core persona configured as an adult Indian male with natural Indian English/Hindi/Hinglish speech.
- `frontend/src/utils/nativeSpeech.js`, `ChatArea.jsx`, and `frontend/android/.../SmaranSpeech.java` were changed for continuous dictation, delayed final speech recognition results, explicit manual-stop behavior, native TTS selection, and Indian locale preference.
- `frontend/android/.../MainActivity.java` applies Android system-bar insets to prevent the header being covered.
- `HackerVoiceAssistant.jsx`, Energy Core components, and CSS were upgraded for answer-aware cyberpunk/AGI presentation. Ensure UI beauty never compromises readable answers or controls.
- Amarya/MMD logic was changed to hold a front-facing pose instead of continuously rotating. This still requires a real visual acceptance test.
- Video package installation already has staging/atomic promotion/progress safety work and tests, but the real large package install and first model download remain unproven.

## Complete this work in this order

### 1) Establish a clean, truthful audit baseline

Inventory running processes, ports, source changes, package manifests, Android signing config, installer config, websites, and device state. Use `rg` first for code discovery. Start relevant services from isolated `.cache/audit` data directories so test state does not damage the owner’s normal app data.

Run the backend, frontend, Android, extension, and plugin test suites. Capture failures verbatim. Fix genuine defects. Never downgrade/disable tests to make a dashboard green.

Run `git diff --check` and fix only whitespace errors in files you actually modify. Keep unrelated changes intact.

### 2) Make every Skills / Plugins / MCP / Connector surface real

For every item shown in the SMARAN Extensions/Skills/Connectors UI:

- trace its UI action to the backend route, persistence, executable/plugin code, and a real success/failure result;
- test at least one safe operation for each built-in plugin/connector that has no additional credentials;
- show "needs setup" with exact steps for credentialed integrations, never "connected" by default;
- ensure saved custom MCP configuration is persisted and its tool discovery/probe is run before it can show Active;
- ensure custom skills are draft-only until there is an executable implementation and at least one recorded test/result;
- make plugin/connector failures non-blocking, cancellation-aware, time-bounded, and visible in the UI;
- check localhost SSRF/path traversal/process argument injection risks for custom MCP and CLI integrations.

Complete the `agents-cli` discovery repair described above. Preserve Windows UTF-8 output handling (`encoding='utf-8', errors='replace'`) and add a regression test for non-ASCII CLI output.

### 3) Build the requested real multi-agent Director

The owner requested an ALTREX DIRECTOR-style multi-AI system: one project prompt, a director analyzes it, creates a task graph, assigns non-overlapping work to specialists (UI, features, backend, review/test), tracks ownership/dependencies, retries/falls back across providers, and consolidates the result.

Do not copy a third-party product or claim Genspark/AgentRouter parity without real functionality. Inspect the existing architecture and implement the smallest complete, useful version that works locally and through configured providers:

- project intake, file/context selection, task decomposition, explicit task ownership, dependency graph, status/events, and final reviewer pass;
- duplicate-work prevention through a shared task registry and claimed file/module scopes;
- provider/model capability routing, health checks, timeouts, rate-limit/backoff, cancellation, bounded retries, transparent fallback reason, and no automatic paid provider selection;
- per-task prompts that state context, scope, acceptance criteria, prohibited overlap, and handoff format;
- safe workspace edits: diff preview, explicit test commands, merge/conflict detection, and rollback/recovery for failed task output;
- an accessible UI that lets a user see which model is doing what and why;
- unit/integration tests covering decomposition, duplicate prevention, provider failure, rate limit, timeout, fallback, cancellation, and consolidation.

Use a real end-to-end acceptance test: give the Director one prompt to build a small YouTube-style demo in a disposable test directory, have separate roles produce non-overlapping parts, run the generated project, and record results. If no valid provider credential is configured, test the orchestration state machine with deterministic local test doubles and clearly label it as such; do not fabricate cloud output.

For the owner’s request about Genspark sidebar and skills: map each requested visible capability to one of (a) implemented real SMARAN feature, (b) configured external integration with truthful setup state, or (c) not implemented. Build useful missing local-first functions where practical; do not create decorative, nonfunctional feature cards.

### 4) Finish mobile UX and physical-device testing

Use the connected Android device and test the installed **newly built** APK, not just Chrome emulation.

Required acceptance cases:

- Portrait and landscape: header, model selector, content, sidebar, composer, attachment button, send button, keyboard behavior, and safe areas must remain usable. The Performance section and mobile-only-unwanted sidebar settings must be hidden on phones; sidebar expansion/collapse must behave intentionally in landscape.
- There must always be a visible close/back path from the Model Hub/OpenRouter model list.
- The reply/code card shown in prior screenshots must not overflow or hide the Copy/Download controls behind Amarya. Test narrow 360–430px widths, long code lines, Hindi/English mixed text, and scroll.
- Tap Speak and verify that it opens/plays or explains the real unavailability reason. Do not report voice input unavailable when supported native recognition is available and permission is granted.
- Test long dictation on the physical phone: at least 30 seconds each of English, Hindi, and Hinglish with natural pauses. Verify final transcript preservation, line/sentence continuity, cancel, no-match, runtime error, and manual stop. The original bug was that sentences were cut off; this must be physically demonstrated, not inferred from unit tests.
- Test Energy Core speech on the actual device. Paired/native use should prefer the backend neural Indian male voice when available; standalone Android must select an installed Indian male voice when supported and show a truthful unavailable/download-language-data state otherwise. Android TTS cannot guarantee a particular voice on every phone, so never promise a voice installed by the OS is a specific human.
- Verify Amarya stays front-facing during a long reply and while the Energy Core opens/closes; no unwanted rotation, clipping, touch interception, or overlap.
- Reinstall the new signed release using `adb install -r`, capture screenshots/video or UI-test artifacts, and confirm app version, permissions, and cold startup.

### 5) Finish the Energy Core product quality

Keep the new neon/cyberpunk/JARVIS-style direction, but make it purposeful:

- state-driven visual language for idle, listening, thinking, responding, success, warning, error, and offline states;
- answer-aware, compact expressions and motion that do not obscure text, controls, accessibility focus, or device performance;
- `prefers-reduced-motion`, keyboard navigation, screen-reader labels, contrast, and graceful GPU/CPU fallback;
- no continuous expensive canvas/WebGL loop when the panel is closed or the app is backgrounded;
- natural adult male Indian voice instructions for English/Hindi/Hinglish and speech queue/cancel/error handling;
- precise user-facing errors if neural TTS/voice data/microphone permission is unavailable.

Run visual and performance checks on desktop and the physical phone. Add only targeted tests that protect the interaction.

### 6) Repair and prove video-generation package installation

The owner saw a real Windows `PermissionError: [WinError 5] Access is denied` under `...SMARAN.AI\\data\\video-packages\\google\\_upb\\_message.pyd` while installing video packages. Find the actual lock/permission cause. Do not delete user package data blindly.

Make installation idempotent and robust: lock handling, process detection, temp/staging directory, atomic promotion, cleanup/recovery, clear disk/RAM requirements, cancellation, resume where technically possible, package integrity/version checks, and user-readable errors.

Show real byte-based percentage, downloaded/total size, speed, ETA when Content-Length is known, indeterminate state when it is not, and distinct phases for package dependencies versus model weights. Do not show invented percentages.

Validate with a small controlled download/install and error injection. If a genuine 2–28 GB model cannot be downloaded in this session, preserve the large-download guardrails and document the remaining real-world test precisely instead of claiming it passed.

### 7) Windows app, installer, CLI, and Docker

The earlier desktop startup failure was: "The local engine did not become ready in time, so the window was not opened." Rebuild from current source, then test a fresh isolated packaged executable with no development server. Verify engine readiness, first-run data creation, offline startup, shutdown/restart, logs, and actionable diagnostics.

Complete the currently running/latest Windows build before creating the final installer. The expected command pattern is:

`python build_exe.py --output-root .cache/audit/windows-build --incremental`

Then build the Inno Setup installer from that exact fresh `dist` folder (do not ship the old `dist-release` installer), install it into an isolated path, start it, test upgrade/uninstall, and record SHA-256/version. Ensure startup timeout diagnostics identify the child process/port/log location.

Test the CLI from its packaged location: `--help`, a simple local command, invalid input, non-ASCII Hindi output on Windows, exit code, and error text.

Docker Desktop’s separate crash has diagnostic ID `B74DAF97-DFAC-4E2A-A40D-21425F838BAA/20260907134534` and an error involving `C:\Users\shash\AppData\Local\Docker\run\dockerInference`. Diagnose it safely, collect Docker diagnostics/log evidence, and determine whether it affects SMARAN. Do not factory-reset Docker or delete Docker data without a concrete, reviewed backup/recovery plan. SMARAN must not require Docker for normal local operation.

### 8) Linux package validation

An older Linux artifact exists under `.cache/audit/linux-current/`, but it predates some current source changes. Build fresh Linux artifacts from the final source in the project’s supported Linux build environment. Test extraction/install, executable startup, engine readiness, CLI, permissions, missing dependency message, and clean uninstall. Record distro/container and toolchain versions. Do not call an untested cross-compiled binary production-ready.

### 9) VS Code extension end-to-end

Use the current extension source and test a real controlled coding workflow:

- install the fresh VSIX into a disposable VS Code profile;
- open a tiny disposable project;
- invoke the extension to create/modify a small feature from a prompt you write;
- confirm files, diffs, diagnostics, cancellation, error/retry, provider failure, and no recursive delegation;
- run the generated project’s tests/build;
- package fresh VSIX and record version/SHA-256.

Retain the explicit one skipped Windows symlink test unless you can make it pass safely; document it exactly.

### 10) Websites and deployment

Marketing site source is `website/`. A current preview was deployed successfully:

`https://6a9feb785563c3765197869c--smaran-ai.netlify.app`

The current production marketing site is `https://smaran-ai.netlify.app/`. The latest APK was copied to `website/downloads/SMARAN-AI.apk` and cache-busted by `website/stamp.py`; verify the preview download hash, page behavior, mobile layout, HTTPS headers, and no exposed secrets before publishing the same verified deploy to production.

Analytics site production is `https://smaran-analytics.netlify.app/`; an older preview is `https://6a9ed697ea9d19213a364e03--smaran-analytics.netlify.app`. Audit it separately. Existing analytics/ingest credentials must remain only in Netlify/server-side environment variables or an approved secret store, never frontend bundles. Test unauthenticated denial, authorized ingestion with a disposable/safe event if credentials are configured locally, dashboard error handling, privacy behavior, and deploy preview before the already-authorized production update.

Do not publish a deployment merely because it builds. Publish only the reviewed preview that corresponds to the final artifact, then verify production version/hash/health. Maintain rollback details.

### 11) Final verification and delivery

Before saying complete:

1. Re-run all relevant automated checks after the last source change.
2. Test the final APK/device, fresh Windows installer, fresh Linux artifact, fresh VSIX workflow, both Netlify production sites, plugin/MCP real calls, and Director acceptance test.
3. Check startup/shutdown, cancellation, offline mode, bad-network behavior, permissions, storage limits, and obvious security boundaries.
4. Scan final APK/site bundles/installer inputs for secrets.
5. Update `docs/VERIFICATION-2026-09-08-CURRENT.md` (or a new dated successor) with exact commands, pass/fail results, artifact sizes/SHA-256, deployment URLs and IDs, device details, and limitations.
6. Give the owner a concise final report: what changed, what was proved, artifact locations, live URLs, and only any remaining limitation that has actual evidence. Do not use phrases like “100% complete” unless every requirement has a corresponding real acceptance result.

Do the work now. Do not ask the owner to repeat information already in this prompt. Ask only when a physical-device unlock, a replacement credential, or a truly irreversible production decision is required.

---

End of prompt.
