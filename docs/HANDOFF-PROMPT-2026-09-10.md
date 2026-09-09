# SMARAN.AI — takeover prompt (state at 2026-09-10)

Paste everything below the line into the new agent.

---

You are taking over SMARAN.AI, a local-first AI assistant at
`C:\Users\shash\Desktop\SMARAN.AI`. It ships as an Android app, a Windows
desktop app and installer, Linux packages (`.deb`, `.rpm`, `.tar.gz`,
`.AppImage`), a CLI for Windows and Linux, a VS Code extension, and a Netlify
website.

## How to work

**Implement and verify. Do not plan, do not suggest, and never report anything
as done without evidence you produced in this session.** Run the thing. Read the
output. If a check fails, say so with the output rather than describing what
should have happened.

Record what you verify in `docs/VERIFICATION-2026-09-09.md`, which already has
~1180 lines in this format, each pass ending with a "what is NOT verified"
section. Keep that habit: the value of the file is that it separates what was
observed from what was assumed.

Three failure modes have already cost real time here:

1. **Reading a stale artifact and calling it a pass.** A VS Code smoke test was
   reported green from a two-day-old results file, because
   `code.cmd --extensionTestsPath` silently does nothing without
   `--extensionDevelopmentPath`.
2. **Trusting timestamps.** The tree is on `/mnt/c`, which WSL mounts 9p/drvfs
   **without `metadata`**: `chmod` does not persist, everything reads `0777`,
   and mtimes do not survive a copy. Verify artifacts by **content** - grep the
   bundle for a marker that only exists after the change. This caught an APK one
   day and 388 bytes stale that would have shipped a release without its
   headline fix.
3. **Reasoning instead of measuring on the device.** Three separate "bugs" -
   a second voice command ignored, YouTube not floating, the app going quiet -
   turned out to be one thing, and only the logs showed it.

## Hard rules

- Never request, print or store passwords, PINs, API keys or tokens.
- Never put credentials or private URLs into source, APKs, the website, logs,
  test fixtures, commits or chat output. An OpenRouter key was once pasted into
  chat; treat it as compromised. The owner rotates their own keys.
- Do not modify unrelated projects, reset Docker, delete user data, bypass
  device security, or change system configuration.
- **Preserve existing work.** Do not reset or clean the worktree. The owner
  moves work between agents, and it can arrive uncommitted - see below.
- Never operate the unrelated "Drafting Coder" VS Code workspace.
- `packaging/linux/build_linux.sh` removes its package output directory. Do not
  rerun it blindly; confirm every deletion target is inside the intended tree.
- Publishing, deploying, releasing or anything outward-facing needs the owner's
  explicit yes **each time**.
- The owner sometimes hands work to another agent and back. **Run
  `git status` before `git log`** - their changes may be uncommitted in the tree,
  and a reset would destroy them.

## Where things stand

`main` at `f224530`, working tree clean, no feature branches.
Tags `v2.10.29` → `v2.10.36`; the source repo and the downloads repo agree.

**v2.10.36 is the published release** and `smaran-ai.netlify.app` serves it.
**Twelve commits sit on `main` that are not in it**, including everything about
device control, the foreground service and pronunciation. Any release must
rebuild all platforms - the version is baked into every frozen binary.

Release asset names are fixed and versionless (`SMARAN.AI-Setup.exe`,
`SMARAN.AI-x86_64.AppImage`, `smaran-ai_amd64.deb`, `smaran-ai.x86_64.rpm`,
`smaran-ai-linux-x86_64.tar.gz`, `smaran-linux-x86_64`, `smaran.exe`,
`SMARAN-AI.apk`), because the website links to
`releases/latest/download/<name>`. Keep them or the download page breaks
silently.

### Android device control - the current focus

`frontend/android/app/src/main/java/ai/smaran/app/`:

- `SmaranDevice.java` - Capacitor plugin: open apps, YouTube, music, URLs,
  picture-in-picture, and starting/stopping the listening service.
- `SmaranVoiceService.java` - **foreground service**, microphone type, ongoing
  notification with a Stop action. This is what makes a second command work.
- `DeviceActions.java` - command patterns and execution, **shared** by the
  plugin and the service so they cannot disagree.
- `SmaranSpeech.java` - recognition and TTS for the on-screen case.

Things that were learned the hard way and must not be undone:

- **`getContext()` on a plugin is the Application context.** An activity started
  from it is a background launch, restricted since Android 10; the symptom is
  success reported and nothing appearing. Launch from the Activity, or from the
  foreground service.
- **`resolveActivity` lies since Android 11.** It answers through the
  package-visibility filter, so it returns null for a package the manifest has
  not declared interest in - it reported "no YouTube" on a phone that has it.
  Try the launch and catch the failure instead.
- **The manifest deliberately avoids `QUERY_ALL_PACKAGES`** (Play treats it as
  dangerous). App discovery uses a scoped MAIN/LAUNCHER `<queries>` entry.
- **`handleOnPause` must not tear down recognition in picture-in-picture.**
  Entering PiP pauses the activity, so it used to go deaf the instant it floated.
- **`stop`, `cancel` and "band karo" are deliberately absent from the refusal
  list** in both the JS and Java detectors - "awaz band karo" is a real
  instruction. The test suite catches this; do not "tidy" them back in.

### Other work on main since the release

- **Lyrics-style caption**: the spoken words light up and the box scrolls to
  follow the voice. Alignment is by **word**, not character, because
  `speakableText` strips markdown before the engine sees it and offsets drift.
  `frontend/src/utils/spokenProgress.js`, 22 tests.
- **Pronunciation**: the voice is chosen from the reply's script, not from the
  language picker. `frontend/src/utils/speechSegments.js`, 13 tests.
- **Speak on Android** was fixed in 2.10.35 - it used to open a WebView recorder
  alongside Android's recogniser and silence it.

## What is NOT done

### Needs the owner

1. **Confirm the second command works.** The foreground service is verified
   running, holding the microphone and surviving another app taking the
   foreground - but nobody has spoken "open YouTube" while WhatsApp is in front.
   This is the single most valuable thing to confirm.
2. **Confirm pronunciation improved**, and whether replies come back as
   romanised Hindi (see the limit below).
3. **Confirm the caption scrolling** on the phone. Implemented and unit tested;
   never watched on the device.
4. **Code signing.** Blocked: the only free route (SignPath Foundation) requires
   no proprietary components, and the bundled character model forbids
   redistribution in its own file. The owner has chosen to keep the model. So it
   needs either a paid certificate or permission from the model's author.
5. Energy Core / Amarya voice quality and arm motion - ears and eyes.

### Known limits, not bugs

- **Romanised Hindi is mispronounced.** "Chrome kholo" is Latin script and
  indistinguishable from English by script, which is the only signal used.
  Fixing it needs transliteration to Devanagari; a word list would mispronounce
  ordinary English words instead. Recorded in a test.
- **Closing an app, and clearing recents, are impossible** for a normal Android
  app. No API exists. Both need an AccessibilityService the user enables in
  Settings.
- **Sending a WhatsApp message cannot be completed.** `wa.me` can open WhatsApp
  with the text pre-filled to a contact or to the user's own number, but
  pressing send needs an AccessibilityService.
- **YouTube does not float.** Auto-enter picture-in-picture fires when Android
  routes the transition through the leaving path; YouTube forwards the search
  intent internally and it does not. Once YouTube is in front this activity is
  stopped, and a stopped activity cannot enter PiP. The foreground service keeps
  it *listening*, which was the important half.

### Not started

- Video generation end-to-end (2-28 GB of weights).
- The `.rpm` on a real Fedora/RHEL/openSUSE machine - it has been extracted and
  run, never `rpm -i`'d.
- A 2.10.37 release shipping the twelve commits above.

## Environment notes that save time

- Windows 11, `bash` is Git Bash. **Nested quoting into `wsl bash -c '...'`
  mangles `awk` and `$`** - write a script file and run `wsl bash /mnt/c/...`.
  Git Bash also rewrites `/mnt/c/...` arguments into `C:/Program Files/Git/...`;
  prefix commands with `MSYS_NO_PATHCONV=1`.
- **Heredocs piped to a `python` that is not on PATH hang on stdin.** Windows has
  no `python`; use `/c/Users/shash/AppData/Local/Programs/Python/Python314/python`
  or `python3` inside WSL.
- adb is at `/c/Asdk/platform-tools`. The device is `8f807260`.
  **`uiautomator dump` frequently returns "null root node"** because the WebView
  does not expose its tree, so coordinate taps are often the only option - and
  taps near the bottom trigger gesture navigation and open recents or search.
  Screenshot after every step; do not chain blind taps.
- The app's readiness check uses `urllib`, which honours `HTTP_PROXY`. Set
  `NO_PROXY=127.0.0.1,localhost,::1` or you will route a loopback health check
  through a dead proxy and wrongly conclude the app fails offline.
- There is no env var for the app's port or to suppress the browser launch.
  `_find_free_port` starts at 3003; read the port from the app's log.
- `rpmbuild` 4.18.2 is installed **without root** at `~/rpmlocal/root`. No sudo
  is needed for any packaging.
- Netlify CLI is in the npx cache at
  `.../npm-cache/_npx/da5c1b6ea715e8b4/node_modules/.bin/netlify`, already
  authenticated. Deploys must run from `website/`.
- Inno Setup is at `C:\Users\shash\AppData\Local\Programs\Inno Setup 6\ISCC.exe`,
  **not** under `Program Files (x86)`.
- Frontend unit tests need `node --experimental-vm-modules`.

## Suites

```
backend + cli   326 passing
frontend        123 passing        (node --experimental-vm-modules --test tests/*.test.mjs)
vscode           9 passing
```

Run them before changing anything they cover.

Start by reading the last three sections of the verification log and running the
suites. Then ask the owner to confirm item 1 above, because everything else in
the Android work is built on it.
