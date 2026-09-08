# Independent verification — 9 September 2026

This is an in-progress audit of Claude's `9cf605e` handoff. It does not certify release completion.

## Independently reproduced baseline

- Backend/CLI: `python -m pytest backend/tests cli/tests -q -p no:cacheprovider`: 278 passed, 12 dependency warnings.
- Frontend unit tests: 64 passed.
- VS Code extension: 22 passed, 1 skipped (Windows file-symlink privilege unavailable).
- APK, Windows executable, installer, and VSIX hashes matched the handoff at audit start.
- Android serial 8f807260 is authorized, app version 2.10.34 present. Microphone permission is granted in the active installed profile; the package also has another profile permission record.
- Six live runtime plugin probes passed against the isolated backend on port 3003: headroom, code-risk-scan, task-observer, provider-latency, meeting-notes-import, hyperframes.

## Corrections and fixes

### Linux speech: foreign optional packages shadow the valid bundle

The Linux artifact **does contain** `tokenizers/tokenizers.abi3.so`. `ldd` resolves its dependencies and Python 3.12 imports that bundled package successfully.

Adding the shared project's `data/video-packages` ahead of the bundle reproduces exactly `ModuleNotFoundError: No module named 'tokenizers.tokenizers'`: this directory contains Windows wheels, including `tokenizers.pyd`. The reported missing-hidden-import diagnosis was therefore not supported by the artifact.

`backend/app/video/install.py` now checks installed wheel tags against the active OS/Python before adding an optional package directory to `sys.path`. Incompatible files remain untouched; status exposes the incompatibility. Two regression tests cover refusal without path mutation and acceptance of compatible/native and universal wheels.

Validation: 35 installer safety/progress tests passed. Full backend/CLI suite after this fix: **280 passed, 12 dependency warnings**. Linux read-only activation proof: `tools/verify_video_package_platform.py` rejected foreign wheels and successfully imported tokenizer 0.23.2 from the frozen bundle's `_internal` directory. This is not yet proof of speech transcription through the rebuilt executable.

### Avatar controls

The view-control HUD now has an explicit higher stacking layer and opaque background; FRONT/SIDE/BACK buttons have improved text contrast, focus outline and minimum height. Frontend production build and Android release build succeeded. APK installation returned Success. Visual acceptance of the new HUD remains to be completed.

### Empty conversation history polling

`App.jsx` treated a successful empty session list as a failure and retried every two seconds indefinitely. Successful empty responses now settle. Retry timers are cleared on unmount, and late session responses preserve the current selected session through functional state updates. The new browser regression test passed against the production build, observing more than two former retry intervals.

## Browser evidence and limits

- Both `mobile-reply-voice.spec.js` tests passed: readable fenced explanations and Speak/back handling. These use mocked API responses.
- Initial phone-controls run: three failures because the required backend was absent, not evidence of a layout regression.
- Re-run with a real isolated backend: one passed, two timed out while loading/locating the composer. These remain unresolved; they are not counted as passes.
- Production-artifact follow-up: added opt-in `SMARAN_TEST_PREVIEW=1` to the existing Playwright config to serve the built assets. All **6 tests passed in 19.1s** (empty history, two reply/Speak tests, and portrait/landscape at 390x844, 792x360, 667x375). The development-server loading timeouts remain recorded above; assertions and timeouts were not weakened.
- Test runner also reports conflicting FORCE_COLOR/NO_COLOR environment settings. Gradle reports deprecated dependency/plugin features; neither warning has been silently suppressed.

## Physical speech

Observed the actual phone voice screen showing "Speech detected". That proves a UI/native recognition state, not full sentence transcription or audible voice quality. Requested the owner's 30-second spoken test; the reply "KARO" supplied authorization but no spoken-test result. No claim is made that the original sentence-cutting issue is resolved on the microphone.

After reinstalling the HUD update, opened Dictate on the physical phone and observed the button switch to "Stop dictating". Asked the owner to speak while it is active. Sentence preservation still requires the resulting transcript.

## Release state

### Multilingual speech follow-up

The owner physically tested and reported incorrect words in Dictate and Speak, including languages other than Hindi. This is a confirmed failed accuracy acceptance test. Logs showed the forced `en-GB` on-device recognizer. Both UI callers now use Indian English for the English hint; Android uses the configured system recognizer and requests API 34+ automatic language detection/switching without a two-language allowlist. Backend recordings now request `auto` rather than the reply-language setting. Removed raw transcript logging from Android. These changes do not guarantee recognition quality on every service/language pack.

Frontend lint/build passed; voice unit suite 64 passed. Latest multilingual Android release build succeeded in 14s and `adb install -r` returned **Success**. Physical multilingual accuracy must be re-tested on this newly installed APK; earlier results were from the old recognizer.

Windows rebuild completed successfully but predates the last multilingual frontend changes. Linux PyInstaller completed; final output copy and startup validation are not yet certified. Production sites have not received these changes.

Linux rebuild launched with the compatibility fix; final frozen startup check pending. Subsequent frontend polling fix requires rebuilding frontend-dependent artifacts again. No production deployment or GitHub release update has been made in this audit. Earlier handoff gaps (real video generation, all connector operations, VSIX end-to-end workflow, Linux package formats, analytics authorization, release refresh) remain unverified.

Logs: `.cache/audit/sep9-*.log`. Preserve prior user screenshots, Android data, and all unrelated worktree changes.

---

## Later pass — mobile HUD, caption layout, and voice commands

Continues from `9cf605e` with the Sep 9 working-tree changes preserved. Every
number below was produced in this pass.

### Suites

| Suite | Result |
| --- | --- |
| `pytest backend/tests cli/tests -q` | **308 passed** (280 → 308) |
| Frontend unit | **68 passed** (64 → 68) |
| Frontend lint | no findings |
| Playwright (voice layout, empty session, mobile reply) | **8 passed** |
| Playwright with a live backend on :3003 | 11 passed, including the three `phone-controls` cases |

`phone-controls.spec.js` has **zero** `page.route` mocks and needs a real
backend. Run without one it fails with `ECONNREFUSED 127.0.0.1:3003`, which is
a missing dependency and not a regression — it passed as soon as the packaged
executable was serving.

### 1. All view controls removed from the phone

`VIEW LOCKED`/`VIEW FREE`, `EYES TRACKING`, `FACING HELD`/`FACING FREE`,
`FRONT`, `¾`, `SIDE`, `BACK` and the keyboard hint are gone in **both**
orientations — `html.sm-phone-device .mmd-hud { display: none; }`, keyed on the
existing phone-device detection rather than a viewport width, because a phone
held sideways reports 792px and is not a desktop.

Removed, not made transparent, so they take no space and catch no taps. This
does **not** release the camera or her facing: `viewLocked` and `holdFacing`
both default to `true` in `AvatarMMD`, so with no way to toggle them she stays
locked and front-facing. Confirmed on the device — she is centred and facing
front with no controls drawn.

The previous behaviour, which moved this HUD to the top of the stage on
mobile, is superseded and its rule deleted.

### 2. The answer no longer sits on the character

The stage was four absolutely-positioned layers sharing one rectangle: the
character at `inset-0`, the caption at `top-[18%]`, the message box at a fixed
offset from the bottom, and a status pill. Any long answer was drawn across
her face, and the only remedy available was to guess a pixel offset — which
then broke at a different height.

It is a flex column now: `.voice-stage` → `.voice-main` (`.voice-figure` +
`.voice-caption`) → `.voice-footer`. Separate boxes, so they cannot overlap at
any size. The caption takes at most half the stage and scrolls inside itself;
with nothing said it has no content, no height, and the figure gets the room
back. Sideways `.voice-main` becomes a row, so the character sits beside the
words rather than under them.

New tests: `frontend/tests/visual/voice-stage-layout.spec.js` — five cases
asserting the controls are absent in both orientations, that the figure and
caption rectangles do not overlap, that a long answer scrolls, and that an
empty caption returns its space.

**A defect this introduced, found on the device and fixed.** In landscape the
character collapsed to a sliver about 30px tall. The header and call bar keep
full-size padding, and the same status sentence was printed three times — in
the header, on the stage, and again above the call buttons — leaving the stage
almost nothing. The duplicates are hidden sideways, the padding is tightened,
and the in-stage message box is hidden in landscape, where the keyboard covers
the screen anyway and the same box is one rotation away. Re-verified on the
device: she is visible, front-facing and centred.

### 3. Voice commands to the desktop — three defects

Audited before changing anything; the implementation is real, with
`open_url`/`open_application` actions, a catalog, and Hinglish verbs already
present. Three faults were found by exercising it:

**A YouTube search claimed to be playing.** `detect_browser_command` opened
`youtube.com/results?search_query=…` and said `Playing {query} on YouTube.`
Nothing plays until a video is chosen. It now says it is opening search
results and returns `action: "search"`.

**A refusal executed the command it refused.** `"I do not want you to open
chrome"` opened Chrome, and `"I do not want you to open youtube"` opened
YouTube. The desktop guard was anchored to the start of the line, so it caught
`"do not open chrome"` and missed the same words mid-sentence. A shared
`is_being_discussed()` now looks at the whole line and is used by both paths.

**Hindi word order did not work at all.** Every application pattern required
the verb first, so `"open chrome"` worked and **`"chrome kholo"` did nothing** —
the exact example in the request. Verb-last patterns were added for
`kholo`/`khol do`/`chalu karo`/`start karo`/`open karo`.

**A regression this caused, caught by the suite.** The first refusal list
included `stop`, `cancel` and `band karo`, which broke
`"awaz band karo"` — a real mute command. Those are legitimate verbs here and
were removed from the list; only words that can only be a refusal remain.

New tests: `backend/tests/test_voice_commands.py`, 26 cases covering Hinglish
verb-last order, English order, refusals in both languages, quoted and
question forms, and the honesty of what each command reports doing.

### 4. Sentences cut at natural pauses

The lifecycle was read before anything was changed. It is sound: the watchdog
fires after silence, `waitForFinalTranscript` then waits up to 900 ms more for
the recogniser to commit, and `pollFinalTranscript` correctly returns
`resumed` — aborting the turn — when speech comes back. That path is already
unit tested.

The fault is the size of the window, not the logic. 850 ms plus the grace is
about 1.75 s, which is right for "yes" and wrong for a dictated paragraph,
whose sentences have longer gaps. The fix is not a bigger constant applied
everywhere: `silenceWindowMs()` scales the window with how much has already
been said — 850 ms for a short reply, easing to 2.2 s once the length makes it
plainly dictation. Four unit tests cover the ends, the monotonic middle, and
bad input.

**This is not evidence that recognition is accurate.** It changes when a turn
is considered finished. Whether the recogniser hears the right words is a
separate question that needs a person speaking and comparing.

### Artifacts

| Artifact | Size | SHA-256 |
| --- | --- | --- |
| `app-release.apk` (installed on 8f807260) | 33,627,132 | `3f32b37bce9c4cf2700dadbee495b442549fe0bd9ab39ec7c960bf497aac65a5` |

Device: CPH2573, Android 16, serial `8f807260`, **user profile 0**, app data
preserved (no uninstall). Cold start 301 ms.

### Not verified in this pass

- **Speech accuracy.** Dictate and Speak hearing the wrong words is the
  owner's headline complaint and is untouched by anything here. It needs known
  reference utterances spoken aloud and compared, in Hindi, Indian English and
  Hinglish, over 30–60 seconds with natural pauses. No such test was run and
  no claim is made.
- Voice-to-desktop commands were verified at the detector level, not by
  speaking into the phone and watching Calculator open.
- Windows and Linux artifacts predate this pass's frontend changes and were
  not rebuilt.
- The `.deb` (292 MB) and `.AppImage` (352 MB) at
  `.cache/audit/linux-sep9/dist/linux/` completed, but were built before these
  changes and have not been installed or started.

### VS Code extension — real host, real model

**A correction first.** An earlier attempt in this pass reported the host smoke
test as passing with six checks. That was wrong: `code.cmd --extensionTestsPath`
returns immediately without entering test mode unless
`--extensionDevelopmentPath` is also given, so nothing ran and the result file
being read was **two days old**, from 7 September. Both runs were re-done
properly once the timestamps were checked.

| Run | Result |
| --- | --- |
| Host smoke, correct workspace | **passed: true**, 6 checks, result written this pass |
| Host smoke, wrong workspace | failed on the workspace-path assertion — the harness requires `<audit>/vscode-workspace` |
| Live coding scenario, `gemini-2.5-flash` | failed: the model is retired for new users; the extension reported the provider's own message |
| Live coding scenario, `gemini-3.6-flash` | **failed at HTTP 429, free-tier quota exhausted mid-run** |

Smoke checks, all in a real extension host against the packaged 2.20.1 VSIX:
packaged extension discovered, activated, agent commands registered, agent
webview resolved with scripts and CSP, packaged edit and undo operating in an
isolated workspace, and the packaged `ws` loading.

The live scenario got far enough to be informative. The agent opened its real
panel, made real model calls, proposed real diffs (`stats.cjs: +48 -0`,
`stats.test.cjs: +55 -0`) and wrote both files. **The code it produced is
correct**, checked here independently of the model's own tests:

    summarize([])        -> {count:0, sum:0, min:null, max:null, mean:null}
    summarize([-2,0,5])  -> {count:3, sum:3, min:-2, max:5, mean:1}
    summarize(null)      -> TypeError
    summarize([NaN])     -> TypeError

It then stopped on `gemini refused the request (HTTP 429). You exceeded your
current quota`. `README.md` was never written and `node --test` was never run,
so the scenario correctly reported `passed: false` rather than accepting
incomplete work — which is the property that mattered most about it.

Provider keys were probed without printing them: **gemini works**; `nvidia`
returns 410, `anthropic` 401, `openrouter` 401 "User not found". The
OpenRouter key remains rejected.

### Windows executable rebuilt on current source

    python build_exe.py --output-root .cache/audit/windows-build --incremental
    python tools/verify_frozen_startup.py --name sep9b-windows <exe>

| Artifact | Size | SHA-256 |
| --- | --- | --- |
| `SMARAN.AI.exe` | 70,118,298 | `49aa57a98202aeec2383dce0d7187d4aaa4101f27e3b17292cfe78f4f238c196` |

Startup on the rebuilt binary: `passed: true`, health
`{"status":"ok","version":"2.10.34"}`, frontend served, **ready in 18.88 s**.

### Still outstanding after this pass

- **Speech accuracy** — untouched and unverifiable without the owner speaking.
- The Linux frozen dist and both packages (`.deb` 292 MB, `.AppImage` 352 MB)
  still predate this pass's backend voice-command changes, which are compiled
  into the PyInstaller archive rather than loose files. A frontend-only refresh
  would ship stale Python, so they need a full rebuild before they mean
  anything.
- Neither Linux package has been installed or started.
- The Windows installer has not been rebuilt from this new dist.
- The live coding scenario needs a provider with remaining quota to finish.
- The full plugin/skill/connector/MCP inventory is still the six built-in
  probes plus endpoint checks, not an exhaustive per-feature classification.

### Linux packages rebuilt from current source, and started

The previous packages were built before this pass's backend voice-command
changes. Those are compiled into the PyInstaller archive rather than shipped as
loose files, so refreshing only `_internal/frontend_dist` would have shipped
stale Python. `build_linux.sh` re-freezes **only when the binary is missing**,
so the stale frozen directory was removed first to force a genuine rebuild.
Both deletion targets were confirmed inside the project build directory before
running, and `paths.sh` refuses a build root outside the project.

Build host: **Ubuntu 24.04.4 LTS** (WSL), Python 3.12.3, PyInstaller 6.22.2.
No `sudo` was used at any point.

| Artifact | Size | SHA-256 (first 16) |
| --- | --- | --- |
| `smaran-ai_2.10.34_amd64.deb` | 306,066,486 | `7b5bfb9dda517d0a…` |
| `SMARAN.AI-2.10.34-x86_64.AppImage` | 369,089,016 | `2762931ad543ded0…` |
| `smaran-ai-2.10.34-linux-x86_64.tar.gz` | 399,259,515 | `3ccbe06644f2c810…` |

The `.deb` grew from 305,936,182 to 306,066,486, which is how the rebuild is
known to have changed content rather than repackaged the old tree.

**Package metadata and permissions.** `Package: smaran-ai`, `Version: 2.10.34`,
`Architecture: amd64`, `Depends: libc6 (>= 2.28)`, browsers under `Recommends`
rather than `Depends` — correct, since the Linux build opens a browser window
instead of bundling a webview. Payload is **root/root**, directories 0755,
executables 0755, and **nothing is group- or world-writable**: the 777 that
Windows-mounted WSL paths report, which had made `dpkg-deb` reject the control
directory, does not survive into the package.

**Both packages start.** Extracted and launched with an isolated `DATA_DIR`:

| Package | Ready | Health | Frontend |
| --- | --- | --- | --- |
| `.deb` (extracted, 982 MB installed) | 12 s | `{"status":"ok","version":"2.10.34"}` | HTTP 200 |
| `.AppImage` (`--appimage-extract-and-run`, no FUSE) | 12 s | same | HTTP 200 |

The AppImage bound port 56305 rather than 3003, which was already in use — the
port fallback works rather than failing on a busy default.

**The bundled offline pronunciation resources are confirmed in a shipped
artifact**, which no previous build had. Both runs logged
`Copied averaged_perceptron_tagger_eng from …/_internal/nltk_data` followed by
`Offline voice resources ready`, resolving from inside the package rather than
from an ambient location.

**On portability.** The binary is ELF 64-bit x86-64 and the highest symbol
version it requires is **GLIBC_2.14**, so it does not demand a recent
distribution. That is not the same as "runs on every Linux distribution": it
was built and started on Ubuntu 24.04 only, `dpkg -i` was never run as root,
and no other distribution was tested.

**What was not done.** A real `dpkg -i` install as root, an uninstall
(`dpkg -r`) leaving-nothing-behind check, and any test on a distribution other
than the build host. `rpmbuild` is unavailable, so no `.rpm` exists.
