# SMARAN.AI acceptance checklist — 8 September 2026

Status of each requested item, and what the claim rests on. Items are marked
done only where there is evidence in this repository. Nothing here claims a
complete application, a bug-free build, or a verified device test that was not
actually run.

Evidence lives under `.cache/audit/`.

## Done, with evidence

| Item | Evidence |
|---|---|
| Energy Core redesign | `.cache/audit/energy-core-sep8.md` |
| Amplitude normalisation (core and stage) | 8 unit tests, `frontend/tests/core-signal.test.mjs` |
| Response-tone tint | three measured corona colours, same state and level |
| Reduced-motion path | 2 distinct frames vs 6 when forced animated |
| Frame cost at a phone viewport | median 6.9 ms, 0 frames over 20 ms |
| Fake system claims removed | terminal lines deleted from `EnergyCore.jsx` |
| Camera nudge keys respect VIEW LOCKED | `AvatarMMD.jsx`, keyboard handler |
| Video install: staging, rollback, real byte progress | `3815879` plus Codex's follow-up in the working tree |
| Updater no longer trips Setup's AppMutex | `9179595` |
| No-speech no longer traps the call in an error state | `.cache/audit/speak-fix-sep8.md`, 14 unit tests |
| Missing transcription endpoint told apart from a broken mic | `voiceOutcomeKind`, `classifyTranscriptionFailure` |
| Mobile chat history rename UI | Verified via Playwright mobile viewport in `test_mobile_rename.mjs` (rename icon, input, save/cancel) |
| Audio cancellation race & VAD sensitivity | Tuned VAD thresholds (floor 6, margin 4, onset 140ms); `wasSpeakingRef` protects TTS playback |
| MessageRow speech fallback | `selectedLanguage` prop passed, `window.speechSynthesis` empty-check race resolved |
| APK release build carrying all frontend changes | Built `frontend/android/app/build/outputs/apk/release/app-release.apk` and synced to `dist-release/SMARAN.AI.apk` |
| Installed desktop app static bundle update | Synced updated bundle (`index-v2.10.34-Bs_ANL_B.js`) to `_internal/frontend_dist` |

## Verified as already correct

| Item | How |
|---|---|
| Amarya chest yaw no longer accumulates | `chest.rotation.y` assigned, not `+=`; `holdFacing` defaults true |
| Mobile reply/Speak browser regressions | `.cache/audit/mobile-reply-sep8-final.log`, 2 passed |
| Native speech unit tests | 6 passed with `--experimental-vm-modules` |
| Installed video packages usable | torch 2.14.0+cu126, CUDA available, diffusers 0.40.0 |
| Mobile Chat History Rename | Automated Playwright test: opens drawer, triggers rename input, saves updated title |

The six native-speech failures seen without the flag are an invocation
problem, not a regression. `vm.SyntheticModule` needs
`--experimental-vm-modules`.

## Still pending / Requires real device or installer rebuild

- **Physical Android Phone sideload**: The release APK (`dist-release/SMARAN.AI.apk`) is built with the latest fixes, but ADB is not configured in PATH, so it has not been automatically pushed/installed to a physical phone.
- **Physical Voice/Microphone acoustic check**: VAD sensitivity was mathematically tuned and TTS playback race resolved, but speaking out loud through a real room microphone into the running desktop window needs live human verification.
- **Full Windows Setup Installer (`SMARAN.AI-Setup.exe`)**: PyInstaller / Inno Setup compile for the whole desktop installer has not been run in this pass (only `frontend_dist` in `_internal` was updated).
- **Multi-model director**: `backend/app/director` assembles videos; the VS Code delegate is a bounded child run on the parent's model. Neither is the full requested multi-model architecture.
- **Linux packages, AppImage & website synchronisation**: Not rebuilt in this pass.

## Notes for whoever continues

- The user's installed app owns port 3003 (PID 19984 during this pass). The
  Energy Core bench was served on 5183 for that reason.
- This machine reports `prefers-reduced-motion: reduce`. Anything that looks
  static here may be animating correctly elsewhere; the bench forces the
  preference both ways.
- Canvas measurements must weight by alpha. These surfaces paint one colour at
  varying alpha, so an `r + g + b` probe reads identically everywhere and will
  report a working effect as missing.
