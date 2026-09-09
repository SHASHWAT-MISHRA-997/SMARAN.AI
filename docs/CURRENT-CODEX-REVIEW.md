# Review of Claude changes at 46add0c

The owner returned the project with new commits through `46add0c`. Existing
handoff/verification files are deleted in the worktree; those deletions were
preserved. Read the latest handoff from Git without restoring it. Earlier
2.10.34 build results do not verify this newer source.

## Fresh baseline

- Backend/CLI: 326 passed, 11 warnings, 18.93s.
- Frontend: 123 passed before changes; lint completed successfully.
- Evidence: `.cache/audit/claude-current-*.log`.

## Fixes in this review

1. Device control reported `floated: true` merely because PiP was armed,
   even when both automatic and explicit entry failed. It now reports observed
   floating state. Regression cases failed before the fix and pass afterward.
2. The background voice service started recognition alongside the on-screen
   recognizer. Added Activity visibility ownership: visible UI (including PiP)
   retains recognition; the service destroys its recognizer while visible and
   resumes after the Activity stops. Late background callbacks are ignored
   while the UI is visible. Physical second-command acceptance is pending.
3. Default `npm run test:unit` omitted new device, caption, and pronunciation
   tests. It now runs every `tests/*.test.mjs` file. Fresh default run: 126 pass.
4. Lyrics cursor inserted a zero-width character even without a caption,
   consuming a 29.25px line instead of returning space to the character. The
   existing browser test caught this (6 pass, 1 fail); rendering the cursor
   only for nonempty captions restores all 7 browser tests (17.7s).

Fresh extension suite: 23 passed, 1 skipped. Android compilation passed once
after service ownership changes; final caption-inclusive build is in progress.
Logs: `claude-current-extension.log`, `claude-current-browser.log`,
`claude-caption-browser.log`, `claude-caption-android.log`.

No new production release or deployment in this review. Android build and
physical verification results will be appended when observed. Code signing,
all-language accuracy, real video generation and distro-specific install
acceptance are not certified by these unit tests.

## Installed device build

Final Android build: BUILD SUCCESSFUL in 56s. `adb install -r`: Success,
preserving user data. APK SHA256:
`30D2EA2D7B60E6FA4C24093A933A3C7BFFCD7239A8A73430A33EA6964DE62A9F`.
APK frontend index and index JS contents match the current build byte-for-byte.
Launched app and opened Speak on serial 8f807260. Android reports
SmaranVoiceService is foreground with microphone service type and Stop action.
This proves service lifecycle state, not recognition of a background command.
Requested owner test: open WhatsApp, then open YouTube while WhatsApp is in
front. Result pending. No claim of a successful second spoken command yet.

## Voice complaint follow-up (2026-09-09)

Fixed the mobile handset action: it paused recognition instead of hanging up.
It now closes the conversation and stops speech. Invalidated native listener
initialization and queued language segments after cancellation, and suppressed
late backend audio/error fallbacks after stop. Stabilized the stop callback;
its changing identity caused a maximum-update-depth rendering loop.

Added female/male Hindi persona grammar to standalone mobile model requests,
including the busy-answer message. This is a prompt instruction, not a proof
that every model always follows grammar. Added the reported name-first YouTube
channel command in both Java and JS. It opens YouTube search for the name;
the exact channel URL was not identified and direct channel navigation is not
certified.

Validation: 130 unit tests pass; lint passes; production build passes; 3 mobile
browser tests pass against production preview, including handset close and
absence of rendering-loop console errors. Development-server run timed out on
2 tests during build activity; production-preview results are recorded in
`.cache/audit/voice-hangup-preview.log`. Android assembleRelease succeeded in
1m19s, with existing Gradle/API deprecation warnings. Final APK installation
is not completed: ADB currently lists no device.

Inspected the three supplied ZIP archives without running their binaries.
IRIS documents describe Gemini Live; IRIS-X includes a PCM audio player. No
audio samples or exact voice preset were found in inspected source. Matching
the reference tone is not verified. Android TTS currently uses voice-name
heuristics; opaque system voice names cannot guarantee male gender. Energy
Core natural male voice remains unresolved pending actual voice/provider
selection and device listening verification. No release/deployment claim.

### Continuation: call isolation

Voice responses now retain their originating call generation. Closing and
reopening Speak cannot make a previous call's delayed model/desktop result
speak in the new call. Closing also clears pending voice confirmations.
Stale native utterance stop handles no longer stop a newer utterance.
Regression coverage: 131 unit tests pass; 3 production-preview mobile browser
tests pass; lint and frontend build pass. Logs use the `voice-session-` prefix
in `.cache/audit`. ADB still returns an empty device list. Male voice/reference
tone and exact channel navigation remain unverified; no device install claim.
