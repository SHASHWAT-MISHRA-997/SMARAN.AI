# SMARAN.AI — takeover prompt (state as of 2026-09-09)

Paste everything below the line into the new agent.

---

You are taking over SMARAN.AI, a local-first AI assistant at
`C:\Users\shash\Desktop\SMARAN.AI`. It ships as an Android app, a Windows
desktop app and installer, Linux packages (`.deb`, `.rpm`, `.tar.gz`,
`.AppImage`), a CLI for Windows and Linux, a VS Code extension, and two Netlify
websites.

## How to work

**Implement and verify. Do not plan, do not suggest, and never report something
as done without evidence you produced in this session.** Run the thing. Read the
output. If a check fails, say so with the output rather than describing what
should have happened.

Record what you verify in `docs/VERIFICATION-2026-09-09.md`, which already has
~700 lines of this format, including a "what is NOT verified" section at the end
of each pass. Keep that habit: the value of the file is that it distinguishes
what was observed from what was assumed.

Two failure modes have already happened in this project and cost real time:

1. **Reading a stale artifact and calling it a pass.** A VS Code smoke test was
   reported green from a two-day-old results file, because
   `code.cmd --extensionTestsPath` silently does nothing without
   `--extensionDevelopmentPath`. Check timestamps on anything you did not just
   produce.
2. **Trusting timestamps.** The build tree is on `/mnt/c`, which WSL mounts
   9p/drvfs **without `metadata`**. `chmod` does not persist, everything reads
   back `0777`, and mtimes do not survive a copy. Verify artifacts by
   **content**, not by date. This caught an APK that was one day and 388 bytes
   stale and would have shipped a phone build missing the release's headline fix.

## Hard rules

- Never request, print, or store passwords, PINs, API keys, or tokens.
- Never put credentials or private URLs into source, APKs, websites, logs, test
  fixtures, commits, chat output, or client bundles. An OpenRouter key was once
  pasted into chat; treat it as compromised, never use it. The owner rotates
  their own keys.
- Do not modify unrelated projects, reset Docker, delete Docker data, delete
  user data, bypass device security, or change system configuration.
- **Preserve all existing work.** Do not reset or clean the worktree. Other
  agents (Claude, Antigravity, Codex) and the owner have all made changes here.
- Never operate the unrelated "Drafting Coder" VS Code workspace.
- `packaging/linux/build_linux.sh` removes its package output directory. Do not
  rerun it blindly; confirm every deletion target is inside the intended build
  directory.
- Do not edit scripts while they are running.
- Publishing, deploying, releasing, or anything else outward-facing needs the
  owner's explicit yes **each time**. Approval for one release is not approval
  for the next.

## Where things stand

Branch `fix/video-packages-locked-dll`, head `bad0328`. **`main` is still at
`1370359` (release: 2.10.33) and has not been merged.** All of the work below
lives on the branch.

**v2.10.34 is published and live** —
`SHASHWAT-MISHRA-997/SMARAN.AI-downloads` release `v2.10.34`, eight assets, and
`smaran-ai.netlify.app` deployed. Every download URL was requested afterwards
and every Content-Length matched the staged bytes.

Note the asset names are fixed and versionless (`SMARAN.AI-Setup.exe`,
`SMARAN.AI-x86_64.AppImage`, `smaran-ai_amd64.deb`, `smaran-ai.x86_64.rpm`,
`smaran-ai-linux-x86_64.tar.gz`, `smaran-linux-x86_64`, `smaran.exe`,
`SMARAN-AI.apk`), because the website links to
`releases/latest/download/<name>`. Keep those names or the download page breaks
silently.

### What was fixed and verified

**Packaging**

- The 2.10.33 `.rpm` shipped **every file world-writable**, including
  `/opt/smaran-ai/SMARAN.AI` — a local privilege-escalation primitive. Cause:
  `build_deb.sh` runs inside `fakeroot` (which remembers requested modes);
  `rpmbuild` ran outside it and read the raw 0777 drvfs. Fixed by giving the rpm
  its own `packaging/linux/build_rpm.sh` invoked under fakeroot. Rebuilt package
  reads back 1759 entries, **0 world-writable**, all `root:root`. Extracted to
  ext4 and started: ping ok on 2.10.34, frontend 200, twelve plugins running.
- A `%defattr` spec fix was rejected — it would strip execute bits from bundled
  helpers such as ffmpeg. `fakeroot bash -c <exported function>` was tried and
  fails; the function does not survive, and `set -e` then also kills the
  AppImage step.
- Linux freeze had two blockers, both fixed: numpy/scipy ABI mismatch (system
  scipy against libs numpy 2.5.3), and a `pyo3_runtime.PanicException` from
  Ubuntu's system `cryptography` 41.0.7 being frozen.
- The Linux CLI (`smaran-linux-x86_64`) is built again, from
  `~/smaran-build/libs` with `python3 -m PyInstaller` (the libs tree has the
  package but no console script). Verified with `PYTHONPATH` unset.
- `rpmbuild` 4.18.2 is installed **without root** at `~/rpmlocal/root` via
  `apt-get download` + `dpkg -x`, with `PATH`, `LD_LIBRARY_PATH` and
  `RPM_CONFIGDIR` pointed there. No sudo is needed for any of this.

**Mobile / voice UI**

- All Amarya view controls removed on phones in portrait and landscape (VIEW
  LOCKED, EYES TRACKING, FACING HELD, FRONT/¾/SIDE/BACK, keyboard hints), via
  `html.sm-phone-device .mmd-hud { display: none }`. Camera and facing behaviour
  itself unchanged.
- The answer no longer sits on the character. `HackerVoiceAssistant.jsx` was
  restructured from four absolutely-positioned layers into a real layout:
  `.voice-stage` (flex column) → `.voice-main` (`.voice-figure` flex-1 +
  `.voice-caption` shrink-0) → `.voice-footer`. Not a pixel nudge.
- Ending a call now stops speech (`useEffect` on `isOpen` calling
  `stopSpeaking`).
- React error #310 on the real device: a caption-scroll hook sat **after**
  `if (!isOpen) return null`. Moved above the early return.
- Energy Core is drawn from real state (`resolveCoreState({voiceState, online})`
  plus online/offline listeners), so an offline core no longer renders healthy.

**Voice commands** (`backend/app/web_intents.py`, `backend/app/desktop_agent.py`)

- Hinglish verb-last order works: "Chrome kholo", "notepad khol do",
  "calculator chalu karo".
- `is_being_discussed()` stops negations, questions and quoted text from
  executing. **`stop`, `cancel` and `band karo` are deliberately excluded from
  the refusal list** — they are real commands, and including them broke "awaz
  band karo". The test suite catches this; do not "tidy" them back in.
- A YouTube search is reported as a search (`"action": "search"`), not as
  playing a song.

**Speech timing** (`frontend/src/utils/voiceStatus.js`)

- `silenceWindowMs()` scales the end-of-turn silence window from 850 ms for a
  short reply to 2200 ms for dictation, which is the "it cuts my sentences" fix.
- `pollFinalTranscript()` waits for the recogniser's committed final rather than
  sending the interim text at the watchdog.
- A missing transcription endpoint is classified `unreachable`, not as a broken
  microphone. A standalone phone has no such endpoint and every quiet moment was
  producing a hardware-failure message.

**Other**

- `backend/app/plugins/google_agents_cli.py` now parses the CLI's own
  `Commands:` section instead of a hand-written list, so the app cannot
  advertise a tool that does not exist (it was offering a `grade` tool that was
  not there). 14 real tools discovered.
- A multi-agent Director exists at `backend/app/orchestrator/`
  (`graph, routing, prompts, run, routes`). `select_candidates(allow_paid=False)`
  refuses metered-only runs; `Run._split_by_scope()` discards out-of-scope
  writes; `_stage()` reads `before` itself for rollback, because `propose_write`
  returns no previous content.
- `ProviderError` in `backend/app/agent/models.py` with `rate_limited` /
  `worth_retrying`, and `attempts` on `complete()`.
- CLI crashed writing Devanagari to a redirected file (cp1252
  `UnicodeEncodeError`, zero bytes out). Fixed with `_print_any_language()`.
- Video package install: reported failure and 0% on a real 4.76 GB install; fixed
  and tested.

### Test suites added

`backend/tests/`: `test_agents_cli_discovery.py` (16),
`test_orchestrator_{graph,routing,prompts,run,routes}.py` (101 total),
`test_language_routing.py` (26), `test_video_install_progress.py` (25),
`test_voice_commands.py` (26), `test_mcp_security.py` (17).
`cli/tests/test_output_encoding.py` (4).
`frontend/tests/`: `speakable-text.test.mjs`, `core-states.test.mjs`,
`voice-status.test.mjs`, plus Playwright specs under `frontend/tests/visual/`
including `voice-stage-layout.spec.js`.

Run them and confirm they pass before changing anything they cover.

## What is NOT done

### Blocked on the owner — do not claim these, ask for them

1. **Speech accuracy. This is the owner's original headline complaint and it has
   never been tested.** Everything above about speech is *timing*, not
   recognition. It needs known reference sentences spoken aloud and compared, in
   Hindi, Indian English and Hinglish, over 30–60 seconds with natural pauses,
   with **Dictate and Speak exercised separately**. Make no claim about accuracy
   until that happens.
2. Whether the Energy Core / Amarya voice actually sounds like the friendly,
   polite male tone that was asked for. Code changed; nobody has listened.
3. Whether Amarya's arm movement still looks like a puppet ("katputli").
4. Code signing. The installer ships unsigned — SmartScreen warns and Smart App
   Control blocks it outright. The owner deferred this; the release notes say so.
5. A provider with remaining quota, to finish the live coding scenario.
6. Credentialed connectors.
7. Analytics: two env vars (`SMARAN_ANALYTICS_URL`, `SMARAN_ANALYTICS_KEY`).
   Without them, builds report nothing — which is the correct behaviour for a
   source checkout, and is what the published binaries do. Do not invent values.

### Not started / deferred

- Video generation end-to-end (2–28 GB of weights, never run).
- The rpm on a real Fedora / RHEL / openSUSE machine. It was extracted and run,
  but never `rpm -i`'d, so `%post` scriptlets and dependency resolution are
  untested. Non-Ubuntu distros generally are untested.
- Nobody has downloaded and installed the published artifacts from GitHub. The
  verification is on staged bytes and on the URLs resolving.

### Loose ends worth a decision

- `main` is at 2.10.33 while everything shipped as 2.10.34 sits on
  `fix/video-packages-locked-dll`. The source repo's tags stop at `v2.10.33`.
  Merging the branch and tagging the source repo is unresolved — ask before
  doing either.
- 16 untracked files at the repo root (`phone_*.png`, `*_dump.xml`,
  `frontend/android/.android-user/`) are leftovers from device testing. They
  should be gitignored or deleted. Ask first; some may be evidence the owner
  wants.

## Environment notes that will save you time

- Windows 11, `bash` is Git Bash. Nested quoting into `wsl bash -c '...'`
  mangles `awk`/`$` — **write a script file and run `wsl bash /mnt/c/...`
  instead.** Git Bash also rewrites `/mnt/c/...` arguments into
  `C:/Program Files/Git/mnt/c/...`; prefix commands with `MSYS_NO_PATHCONV=1`.
- Heredocs piped to a `python` that does not exist on PATH will hang on stdin.
  Windows has no `python`; use `python3` inside WSL.
- The app's readiness check uses `urllib`, which honours `HTTP_PROXY`. Set
  `NO_PROXY=127.0.0.1,localhost,::1` or you will route the app's own loopback
  health check through a dead proxy and wrongly conclude it fails offline. This
  already produced one false "the app fails to start offline" report.
- There is no env var to set the app's port or suppress the browser launch.
  `_find_free_port` starts at 3003 and walks up; read the port out of the app's
  log. `xdg-open` failing in WSL is just an absent browser, not a fault.
- `cpio` is not installed; `rpm2archive` ships with rpm and gives the same
  payload as a tar stream.
- Netlify CLI is not installed globally but **is** in the npx cache at
  `C:/Users/shash/AppData/Local/npm-cache/_npx/da5c1b6ea715e8b4/node_modules/.bin/netlify`
  (v27.5.0), already authenticated. Deploys must run from `website/` — the repo
  root is linked to a different Netlify project. Site id
  `dc3a6e25-c361-48c9-b532-ab0b3b2c8443`, project `smaran-ai`.
- `website/downloads/` is gitignored, so the APK it serves only reaches users on
  deploy, never through git.
- Download page size labels are fetched live from the GitHub releases API on
  load; the hardcoded numbers in `index.html` are only the fallback. Update them
  with the same divisor `main.js` uses (`mib` → 1048576, `mb` → 1000000).

## Where the evidence is

- `docs/VERIFICATION-2026-09-09.md` — the running log, most recent passes at the
  end.
- `.cache/audit/` — build logs, screenshots, device dumps, release staging under
  `release-2.10.34/`, Linux build under `linux-sep9/`.
- Release notes for 2.10.34: `.cache/audit/release-notes-2.10.34.md`.

Start by reading the last three sections of the verification doc and running the
test suites. Then ask the owner which of the blocked items they can help with,
because item 1 is the one that still matters most to them.
