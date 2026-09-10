# SMARAN.AI — full handoff, 2026-09-11

Repository root: `C:\Users\shash\Desktop\SMARAN.AI`
Branch: `main`, all work pushed. Latest commit `0fabf0d`.
Source version **2.10.37**. Published GitHub release **v2.10.36**.

Read this whole file before touching anything. Most of it is failures that
already happened; repeating them costs a day each.

---

## 1. WORKING RULES — these are not negotiable

1. **Run `git status` before `git log`.** Several agents work in this tree and
   hand it back with work uncommitted. `git log` will lie to you about state.
2. **Never reset, clean or stash the worktree.** Preserve unrelated changes,
   screenshots (`phone_*.png`, `*_dump.xml`) and intentionally deleted docs.
3. **Never request, print, commit or embed** passwords, PINs, API keys, tokens
   or private URLs. A key pasted into chat earlier in this project is
   compromised and must never be reused. `frontend/android/keystore.properties`
   holds the signing password — Gradle reads it; you never need to see it.
4. **Do not bypass the app's PIN lock.** Ask the owner to unlock it.
5. **Publishing, deploying and releasing need explicit owner approval for that
   specific release.** Build and verify the artifacts first, then ask.
6. **Do not blindly rerun `packaging/linux/build_linux.sh`** — line 63 does
   `rm -rf "$OUT"` on its output directory, and `FROZEN_DIR` is
   `$BUILD_ROOT/dist/SMARAN.AI`, the same path the **Windows** PyInstaller
   build writes to. Set `SMARAN_LINUX_BUILD_ROOT` to a native WSL path or you
   will destroy the Windows build.
7. **Verify artifacts by content hash and extracted contents, never by
   timestamp.** A stale APK and a stale `.vsix` were both nearly shipped in this
   project because the mtime looked right.
8. **Do not suppress warnings to make output look clean.** Remove the dead code
   that causes them, or fix the cause.
9. **Check for a live `git` process before treating an `index.lock` as stale**
   (`tasklist | grep git`). It is usually genuinely stale here — a git process
   died with "Insufficient system resources" — but check.
10. **Do not copy Codex branding** or claim Codex's proprietary backend is
    available in SMARAN.

---

## 2. ENVIRONMENT — exact paths and traps

| Thing | Value |
| --- | --- |
| Python | `/c/Users/shash/AppData/Local/Programs/Python/Python314/python` (3.14) |
| Node | in PATH; Vite 6 / rolldown, Tailwind **v4** (no `tailwind.config.js`) |
| Android SDK | `C:\Users\shash\AppData\Local\Android\Sdk` |
| adb | `$SDK/platform-tools/adb.exe` |
| sdkmanager | `$SDK/cmdline-tools/latest/bin/sdkmanager.bat` |
| Java | OpenJDK 21 |
| Inno Setup | `C:\Users\shash\AppData\Local\Programs\Inno Setup 6\ISCC.exe` (**not** Program Files) |
| WSL | `Ubuntu-24.04` present |
| gh CLI | installed, authenticated as SHASHWAT-MISHRA-997 |
| netlify CLI | **not installed**; use `npx netlify-cli@17`. Credentials already exist at `C:\Users\shash\AppData\Roaming\netlify\Config\config.json` — do not read the token, the CLI uses it itself. |
| Netlify site | `website/` → site `smaran-ai`, id `dc3a6e25-c361-48c9-b532-ab0b3b2c8443`. There are **three** `.netlify` dirs (root, `smaran-analytics/`, `website/`) — deploy from `website/` only. |

### Shell traps that will waste your time
- **`MSYS_NO_PATHCONV=1` is required for every adb command using a device
  path.** Otherwise `/sdcard/x.png` becomes `C:/Program Files/Git/sdcard/x.png`.
- **Python cannot open `/c/...` paths.** Bash sees `/c/Users/...`, Python needs
  `C:/Users/...`. Convert explicitly.
- **Heredocs writing JS/regex through Python get mangled.** `\n` and `\s`
  inside a Python heredoc become real newlines and break the JS file. Use the
  Edit tool for anything containing regex or escapes, not a Python rewrite.
- `grep -r` over this repo is slow enough to time out. Use ripgrep.
- **Windows Device Guard blocks the freshly built unsigned exe.** You will get
  `"blocked by your organization's Device Guard policy"`. You cannot smoke-test
  the Windows build on this machine without the owner allowing it.

---

## 3. WHAT IS DONE AND VERIFIED

**Tests, all green:** `pytest backend/tests cli/tests` = **418 passed**;
`npm run test:unit` (frontend) = **159 passed**; `npx oxlint src tests` =
**0 warnings**; `npm run build` clean.

### Verified on real hardware (Android CPH2573, serial `8f807260`)
APK **2.10.37**, `versionCode 21037`, bundle `index-v2.10.37-BkHAsXwg.js`,
signing certificate `11:19:8A:E2:51:F0:B2:13:FE:5B:4E:DD:2B:81:FE:48…`
identical to the published one, so it updates in place.

- Chat works (Groq, `openai/gpt-oss-120b`)
- Code generation works; code English; runtime + packages stated
- Code block shows **only Copy** (badge / Source Code tab / Download ZIP removed)
- Memory toggles render as pills, not circles
- Memory send arrow sits inside its field
- Sidebar labels readable, no white panels, move-arrow gone

### Real bugs fixed this session (all committed)
- `POST /api/memory` was **declared twice**; Starlette serves the first, so the
  stricter handler was unreachable while its unit tests passed against the
  function object. Merged.
- `DELETE /api/memory/clear` was declared **after** `/api/memory/{memory_id}`,
  so "clear" parsed as an int id → 422. **Clear-all could never have worked.**
- `GET /api/test/ping` and `POST /api/models/compare` each had a dead duplicate.
- **Five `asyncio.create_task` calls kept no reference.** The loop holds tasks
  weakly, so the GC could take one mid-flight — two were the memory extraction
  that runs after a reply finishes streaming. `spawn_background()` in `main.py`
  now holds the reference and logs failures.
- `translate_text` sent the **whole reply including code** to Google Translate.
  Code spans are now split out and restored verbatim.
- English was the only language with **no** `LANGUAGE INSTRUCTION`; the model
  drifted to Hindi. English is now stated explicitly.
- **The phone never reaches `/api/chat`** — with no desktop paired it calls the
  provider directly, so backend prompt rules did not apply. Rules duplicated in
  `frontend/src/utils/replyRules.js`.
- `--color-surface` was overridden under `.dark` but **tree-shaken out of
  `:root`** (Tailwind v4 drops unused `@theme` vars).
- System theme forced the sidebar dark while labels stayed `text-zinc-700` →
  **1.6:1**, unreadable. Now 15.4:1.
- `min-height:44px` under `@media (pointer: coarse)` inflated 44×24 toggles to
  44×44 → circles.
- Conversation list got 125px on a 600px viewport because the nav took a fixed
  401px. Now share one scroller: 357px.
- Design Studio's Generate never sent (see §5).

### Guard tests added — do not delete these
`backend/tests/test_route_registration.py` (duplicate + shadowed routes),
`test_background_tasks.py`, `test_version_consistency.py`,
`test_translation_keeps_code.py`, `frontend/tests/theme-tokens.test.mjs`,
`theme-contrast.test.mjs`, `reply-rules.test.mjs`,
`frontend/tests/visual/sidebar-scroll.html`.
Each was checked by **reintroducing the bug and watching it fail**. Keep that
habit — several tests in this repo passed for years against unreachable code.

---

## 4. WHAT IS NOT DONE

### Never tested by anyone
- **Design Studio** — rewritten to generate in place (commit `0fabf0d`) but the
  app re-locked before this exact build could be exercised. **Verify first.**
- **Connectors & Devices**
- **Voice / Speech**
- **Image generation**
- **The entire Windows desktop app** — built, never started (Device Guard)

### Built but unpublished
- `installer/output/SMARAN.AI-Setup.exe` — 279,023,903 bytes, 2.10.37
- `dist/SMARAN.AI/SMARAN.AI.exe` — 68,865,086 bytes
- APK 2.10.37 in `dist-release/` and `website/downloads/`
- **Linux packages have NOT been rebuilt for 2.10.37** — read rule 6 first
- **CLI binaries have NOT been rebuilt for 2.10.37**

### Published state — currently BEHIND source
- GitHub release: **v2.10.36**
- Live website serves the **2.10.36** APK
- VS Code Marketplace: **2.20.1** ✅ (this one is current and correct)

**Nothing from this session is in any published build.** A user downloading now
gets 2.10.36.

---

## 5. THE DESIGN STUDIO BUG — read before changing it

`ChatArea` is rendered only for `activeView === 'chat'` (App.jsx:624). While
Design Studio is open, ChatArea is **unmounted**, so the
`smaran:send-prompt` event reaches no listener. The prompt survived only via
`localStorage.sm_pending_prompt`, which chat read on mount and put in the
composer — so you landed on a screen still showing the empty welcome state with
your prompt typed in a box and nothing saying to press send.

Design Studio now streams `/api/chat` itself and renders the result in place
(sandboxed iframe preview in Visual mode, raw text in Code mode, Stop/Copy/
Close). **It no longer navigates**, per the owner's explicit instruction.

`ScheduledTasksView` had the same unmounted-listener problem and now sets
`sm_pending_autosend` so the chat actually runs the prompt.

---

## 6. NEXT STEPS, IN ORDER

1. **Ask the owner to unlock the PIN**, then verify in `localhost:8000`:
   Design Studio generates in place; then operate **Connectors & Devices**,
   **Voice/Speech**, **Appearance**, **image generation**. Fix what you find.
2. **Ask the owner to allow the exe past Device Guard**, then start the Windows
   app and confirm `/api/test/ping` returns 2.10.37 and the frontend serves.
3. **Rebuild Linux packages and CLI binaries at 2.10.37** (rule 6).
4. **Only then** ask for approval to publish v2.10.37: upload all platforms to
   `SHASHWAT-MISHRA-997/SMARAN.AI-downloads`, then
   `cd website && npx netlify-cli@17 deploy --prod --dir=.`
5. Update `website/index.html` size fallbacks to the new byte counts — they are
   convention-specific: **Windows uses MiB, the APK uses decimal MB.** This is
   deliberate and documented in a comment there; do not "fix" it.

## 7. OWNER'S STANDING REQUESTS
- Default language **English everywhere**; user may switch it themselves.
- Code must **run as pasted in any IDE**.
- Code blocks: **only Copy**.
- Design Studio: generate **in place**, never redirect.
- The tagline says "Autonomous". It is not autonomous — there is an approval
  toggle and a stop control. Owner has been told; wording is their call.
