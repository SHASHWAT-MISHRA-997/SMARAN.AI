# Takeover prompt — SMARAN.AI

Copy everything below the line into Codex. It is a takeover request: verify
what is claimed, then finish what is not done.

---

You are taking over a live, local-first AI assistant called **SMARAN.AI**.
Work only inside:

`C:\Users\shash\Desktop\SMARAN.AI`

The owner has authorised implementation, local builds, device testing,
installer packaging and Netlify deployment. Your job is to **verify the claims
below with your own commands**, then complete the work that is listed as
unfinished. Do not take any claim here on trust — every one of them is
reproducible, and re-running them is the first thing you should do.

## Non-negotiable rules

1. **Preserve existing work.** Start with `git status --short` and
   `git log --oneline -5`. Never run `git reset --hard`, `git clean`,
   `git checkout` over modified files, or stash. Do not reformat files you are
   not changing. Do not delete application or user data.
2. **No credentials anywhere.** Not in source, commits, logs, tests, APKs,
   websites, chat output or client bundles. The OpenRouter key currently
   configured is **rejected by the provider and is exposed** — tell the owner
   to rotate it and set the replacement themselves in Settings. Never ask for
   it in chat.
3. **No fake integrations.** A card reading Connected/Active/Installed must
   correspond to persisted configuration plus a real successful probe. A
   custom skill stays a Draft until an executable implementation exists.
4. **Never turn a missing credential, unavailable service, unsupported phone
   API, rate limit or failed install into a success.** Give a precise error
   and a useful action instead.
5. **Fix root causes, add focused regression tests.** No hard-coded success,
   no long blocking work on request threads, no silent fallbacks, no simulated
   progress.
6. **Test source before packaging; test the packaged artifact separately.**
   Update the verification document with exact commands, results, dates,
   artifact hashes and known limitations.
7. **Do not weaken a test to make a dashboard green.** If a check fails,
   either fix the cause or record the failure.

---

## Current state — verify all of this first

Branch `fix/video-packages-locked-dll`, commit **`9cf605e`**, pushed to
`origin`. `main` is at `1370359` and untouched. The working tree is
intentionally dirty (test screenshots and UI dumps at the repo root are
deliberately uncommitted).

### Run these and confirm the numbers

```bash
python -m pytest backend/tests cli/tests -q -p no:cacheprovider   # expect 278 passed
cd frontend && npx oxlint src tests                                # expect no findings
cd frontend && npm run test:unit                                   # expect 64 passed
cd vscode-extension && npm test                                    # expect 22 passed, 1 skipped
```

The single skipped extension test is **"search refuses a file symlink outside
the workspace"**, skipped with the reason *"Windows file symlink privilege
unavailable"*. It is a workspace-escape security test. Do not hide it, do not
reclassify it, and do not change machine settings to force it.

### Artifacts and hashes

| Artifact | Size | SHA-256 |
| --- | --- | --- |
| `frontend/android/app/build/outputs/apk/release/app-release.apk` | 33,626,744 | `7e1103cb6ef333743ab6eb874ec684e4a304c473d1998bc50e27823a3b210c1f` |
| `.cache/audit/windows-build/dist/SMARAN.AI/SMARAN.AI.exe` | 70,115,686 | `f86de8148afc150caad8e6442cc15b0cf0757e4feae913e80bf03d1602923482` |
| `.cache/audit/windows-installer/SMARAN.AI-Setup.exe` | 280,312,115 | `f5b9e2b0440cf61ac959c2b65934291bf58aecaa5f46cb882ec6265839638232` |
| `.cache/audit/linux-build/dist/SMARAN.AI/SMARAN.AI` (ELF) | 43,518,848 | `fafa0fefeb07effb2624ef5c1886cc027452bf50ede0c864bedb2615be9c4221` |
| `.cache/audit/smaran-extension.vsix` | 210,964 | `dc130efddcc5f05800d2dc778bde2ee59740f480e6b9ca932423f82590ffb3e4` |

The APK is byte-identical on the phone, in the build output, and on the live
site. Confirm with `adb pull` and `sha256sum`.

### Environment

- **Device:** CPH2573, Android 16, serial `8f807260`, via
  `C:\Asdk\platform-tools\adb.exe`. Installed versionName 2.10.34,
  versionCode 21034. `RECORD_AUDIO` granted.
- **Local model:** `qwen2.5-coder:7b` in Ollama (4.7 GB, already pulled).
  `nomic-embed-text` is also present and is an embedding model — the app
  correctly refuses to offer it as a chat model.
- **Linux:** WSL Ubuntu 24.04.4, Python 3.12.3. `sudo` requires a password;
  build dependencies live in `~/smaran-build/libs` via
  `pip3 install --target`.
- **Inno Setup:** `C:\Users\shash\AppData\Local\Programs\Inno Setup 6\ISCC.exe`
- **Netlify:** `website/` is linked to project `smaran-ai`. **The repository
  root is linked to a different project (`zippy-naiad-216088`) — always deploy
  from `website/`.**
- **Docker:** broken and irrelevant. Docker Desktop cannot bootstrap its WSL
  distribution (`DockerDesktop/Wsl/ExecError`). SMARAN was shown running with
  the Docker service stopped. Do not factory-reset Docker.

### Live sites

- Marketing: **https://smaran-ai.netlify.app** — published, deploys
  `6aa055bc1b6f64675ae19308` then `6aa05a5fe223ccbd6c9bb7cd`. Rollback via
  the Netlify deploys page.
- Analytics: **https://smaran-analytics.netlify.app** — audited only, not
  deployed. Unauthenticated `POST /ingest` correctly returns 401.

### Read this before changing anything

`docs/VERIFICATION-2026-09-08-CURRENT.md` — every measured result, including
a section titled **"What is NOT verified"**. Treat that section as the
authoritative list of gaps, not this summary.

---

## What was built and fixed (verify, do not assume)

**Multi-agent Director** — `backend/app/orchestrator/`, eight endpoints under
`/api/orchestrator`, UI at `frontend/src/components/DirectorPanel.jsx`.
Named `orchestrator` because `app.director` already turns a script into a
video. Duplicate work is prevented twice: the scheduler never hands out two
tasks whose file claims overlap, **and** each reply is checked against its own
claim before anything is written. In both real runs against the local model
the reviewer tried to write code and was refused. Nothing paid is ever
selected automatically.

**agents-cli** ran `--help`, discarded it, and returned a hand-written tool
list advertising a `grade` command the CLI does not have.

**RAG said ON while the request had dropped it** — `/api/chat` sets
`rag_enabled=False` whenever `web_search` is on, but the two buttons were
independent; and the frontend required a collection to be selected.

**Only English and Hindi worked** — language detection is offline and free but
ran only when the picker was set, and the picker defaults to English.

**A female character spoke as a man** — nothing had told the model its gender;
Hindi verbs carry it.

**The assistant read punctuation aloud** — bullets, table pipes, arrows,
emoji, long dashes.

**Ending a call did not stop the voice.**

**The Energy Core drew a healthy cyan core when offline**, and its render loop
kept running when backgrounded (now 0 frames, measured).

**Video packages** — a real 4.76 GB install reported itself *failed* while
every file was in place, and showed 0% throughout because every wheel came
from pip's cache. Cancellation, disk-space checks, speed and ETA did not
exist.

**Windows startup diagnostics** named nothing; the **CLI crashed writing Hindi
to a file** (`UnicodeEncodeError` on cp1252, zero bytes written).

**Website** — a "Download the VSIX" button returned 404; seven amber panels
shouted equally, most being instructions rather than warnings.

---

## WHAT IS NOT DONE — this is your work

Ordered by how much it matters. Nothing below is verified; treat all of it as
outstanding.

### 1. Speech and dictation on the physical phone — HIGHEST PRIORITY

This is the original reported bug and it has **never been verified**. All the
code changes are in place; none has been confirmed by ear.

- Long dictation: **at least 30 seconds each of English, Hindi and Hinglish**,
  with natural pauses. Verify the final transcript is preserved whole,
  sentence continuity holds, and sentences are not cut off. The original
  complaint was "it cuts my sentences".
- Verify cancel, no-match, runtime error and explicit manual stop.
- Tap **Speak** and confirm it opens and plays, or states the real
  unavailability reason. Do not report voice input unavailable when native
  recognition exists and permission is granted (it is granted).
- Energy Core speech on the device: paired/native should prefer the backend
  neural Indian male voice; standalone Android should select an installed
  Indian male voice or state a truthful unavailable/download-language-data
  state. Android cannot guarantee a specific voice — never promise one.
- Watch **Amarya's arm movement in motion**. The animation was changed
  (eased poses, desynchronised per-arm pulse, elbow follow-through) to fix a
  reported "puppet/katputli" look. It builds and lints; it has not been
  watched.
- Confirm the character speaks in **feminine Hindi forms** ("मैं कर सकती हूँ",
  never "सकता", never the hedged "सकता/सकती"), and that only the Energy Core
  uses a male voice. Tone should read as a friendly, polite friend.

### 2. Model weights and video generation

- No model weights (2–28 GB) have been downloaded and **no video has ever been
  generated**. The 4.76 GB package install came entirely from pip's cache, so
  a genuine multi-gigabyte *network* transfer has never been observed. The
  largest real transfer measured anywhere is 13.1 MB at 6.17 MB/s.
- Verify byte-accurate percentage, downloaded/total, speed and ETA against a
  real long download; verify the indeterminate state when Content-Length is
  unknown; verify the distinct phases for package dependencies versus model
  weights.
- Inject disk exhaustion **during** an install (only the up-front refusal is
  tested) and verify recovery.
- Then actually generate a video end to end.

### 3. Linux artifact gaps

- **The Linux build cannot transcribe speech**: `No module named
  'tokenizers.tokenizers'`. The package is present but PyInstaller did not
  bundle its compiled Rust submodule. Windows does not have this problem. The
  likely fix is a hidden import; it was deliberately **not** applied because it
  was not rebuilt and re-run, and an unverified fix is worth less than a stated
  gap. Fix it and prove it.
- **No `.AppImage`, `.deb` or `.rpm` was produced.** `packaging/linux/build_linux.sh`
  makes all four formats but needs `appimagetool` and `patchelf`, which need
  `sudo`. Ask the owner to install them, then build and test extraction,
  install, startup, CLI, permissions, missing-dependency message and clean
  uninstall for each format. `check_packages.sh` has never been run.
- Two build failures were caused by mixing `pip --target` with Ubuntu's system
  packages (numpy/scipy ABI mismatch; a system `cryptography` whose pyo3
  extension panics when frozen). A proper venv would avoid both —
  `python3-venv` is not installed.

### 4. VS Code extension end-to-end

Only unit tests and packaging were done. Not done:

- Install the VSIX into a **disposable VS Code profile**.
- Open a tiny throwaway project, drive the extension to create/modify a small
  feature from a prompt.
- Confirm files, diffs, diagnostics, cancellation, error/retry, provider
  failure, and no recursive delegation.
- Run the generated project's tests/build.

### 5. Plugins, MCP, connectors — full audit

Only the `agents-cli` defect was fixed. For **every** item in the
Extensions/Skills/Connectors UI:

- Trace the UI action to its backend route, persistence, executable code and a
  real success/failure result.
- Test one safe operation per built-in plugin/connector that needs no extra
  credentials. (`python tools/verify_runtime_plugins.py` covers six and passes
  **only while a server is running on port 3003** — a connection-refused run
  shows six FAILs that are not regressions.)
- Credentialed integrations must show "needs setup" with exact steps, never
  "connected" by default.
- Saved custom MCP configuration must persist, and tool discovery/probe must
  run before anything shows Active.
- Custom skills stay draft-only until an executable implementation and a
  recorded test result exist.
- Check localhost SSRF, path traversal and process-argument injection for
  custom MCP and CLI integrations.

### 6. Remaining verification

- **Offline startup** of the Windows app (never tested; it would have meant
  disabling the machine's network).
- **Analytics**: authorized ingestion with a disposable event, dashboard error
  handling, privacy behaviour, and a preview deploy. No analytics credential
  is configured locally.
- **An end-to-end Hindi answer through the CLI** — blocked on the rejected
  OpenRouter key.
- **A Director run against a cloud provider** — same blocker. Note that in
  both local runs the 7B model wrote files under `src/` instead of the four
  requested at the project root, and in the second run its own reviewer
  returned `pass` while the acceptance checks failed. That is a model-quality
  observation, not an orchestration fault, but a stronger model should be
  tried.

### 7. Known smaller issues, unfixed

- The GitHub release is **v2.10.33** while the source is 2.10.34, so every
  download link on the site except the APK serves artifacts one version
  behind. Refreshing means uploading ~1.9 GB of installers.
- No `.vsix` has ever been attached to a release; the site's download button
  was removed rather than left returning 404. A VSIX exists at
  `.cache/audit/smaran-extension.vsix` (v2.20.1).
- On the voice screen the `FRONT` view button sits behind the character's hair
  and is hard to read.
- The landscape composer takes roughly a third of the screen once the toolbar
  wraps, leaving about two lines of conversation.
- This machine's **ambient torch/torchvision pairing is broken**
  (`RuntimeError: operator torchvision::nms does not exist`) independently of
  the installer, so the newly installed video packages have not been shown to
  run.
- Test debris is uncommitted at the repo root: 12 `phone_*.png`, three
  `*_dump.xml`, and `frontend/android/.android-user/debug.keystore.lock`.
  Commit or gitignore them, do not delete without asking.

---

## Useful commands

```bash
# Rebuild the phone app and install it
cd frontend && npm run build && npx cap sync android
cd android && ./gradlew assembleRelease
"C:/Asdk/platform-tools/adb.exe" install -r app/build/outputs/apk/release/app-release.apk

# Windows executable and installer (installer must come from the fresh dist)
python build_exe.py --output-root .cache/audit/windows-build --incremental
"C:/Users/shash/AppData/Local/Programs/Inno Setup 6/ISCC.exe" \
  /DSourceDir=<abs path to that dist> /O<output dir> installer/SMARAN.AI.iss

# Evidence-producing checks that already exist
python tools/verify_runtime_plugins.py        # needs a server on :3003
python tools/verify_video_install_lock.py     # reproduces the WinError 5 collision
python tools/verify_video_install_cancel.py   # real download, cancelled mid-flight
python tools/director_acceptance.py           # real local model
python tools/director_acceptance.py --simulated
python tools/run_video_install.py             # the real multi-GB install

# Deploy (ALWAYS from website/, never the repo root)
cd website && python stamp.py
cd website && npx netlify-cli deploy --dir=.          # preview
cd website && npx netlify-cli deploy --prod --dir=.   # production
```

## How to finish

Work in the order above. After each change, re-run the relevant suites and
update `docs/VERIFICATION-2026-09-08-CURRENT.md` with exact commands, results,
dates, artifact sizes and SHA-256s, deployment URLs and IDs, device details
and remaining limitations.

Ask the owner only when you need a physical-device action they must perform
(speaking into the microphone, listening to speech), a replacement credential,
a `sudo` install, or an irreversible production decision.

**Do not report the work complete while anything in section 1 is unverified.**
Speech and dictation on the real phone is the original complaint and the
largest untested surface. Everything else is secondary to it.
