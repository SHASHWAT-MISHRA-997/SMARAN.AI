# SMARAN.AI — where the work stands, and how to carry it on

You are picking this up cold. Read all of it before touching anything. It is
written to be handed to a different assistant, so nothing here assumes you were
present for any of it.

---

## 1. What the owner expects, in their words

> "i want 100 % real and honest genuine. always true... i don't want fake,
> false, random guess, misleadings"

> "jaha bhi kuch samajh na aaye Google se help lo, web search karke, githubs,
> research papers, google scholar, journal, company sites, startups etc. jaha
> se jo bhi informations mile aur data, pehle usse acche se padho aur samjho
> then implement karo"

Two rules follow from that, and they are not decoration:

**Do not report something as working because the code looks right.** Run it.
Every single failure in this project so far was code that compiled, passed
review, and had never been executed on the path that mattered.

**When you are wrong, say so in the same breath.** Corrections belong in the
reply and in the commit message. Do not quietly delete a claim that turned out
to be false — replace it and say it was replaced.

The owner speaks Hindi/Hinglish. Reply in that register. Long English essays
are not read.

---

## 2. Hard-won lessons — read these or you will repeat them

These are all real, all from this project, all cost hours.

1. **A dependency that is not packaged does not exist.** `ws` was added for the
   browser tools; `.vscodeignore` excluded `node_modules/**`; the extension
   compiled, tested and would have died on `Cannot find module 'ws'` the first
   time anybody used it. Always run `vsce ls` and look for what you added.

2. **A listing is a claim, not proof.** Google lists `gemini-2.5-pro` for this
   account and answers 404 for it. NVIDIA lists 81 models and every one answers
   404. Ask the thing, do not read about it.

3. **"Already exists" is not proof of write access.** `gh release create` does
   a GET first and stops if the tag exists, so a read-only token produces a
   message that reads like success. It cost three releases.

4. **A depth limit that is not enforced is a comment.** "Only the outermost run
   registers a handler" left the handler registered *during* the nested run, so
   sub-agents nested five deep. Test the limit by trying to exceed it.

5. **Windows shells mangle non-ASCII on the command line.** A Hindi TTS test
   "failed" for an hour because the Devanagari never reached the server intact.
   Send such payloads from a file or from Python, never as a shell argument.

6. **Escaping is eaten between here and the file.** `\s` inside a JS template
   literal collapses to `s` — a whitespace regex silently became a letter-`s`
   regex and reported the name "Shashwat" as "sha hwat". After any edit that
   contains a backslash, read the line back out of the file.

7. **CRLF.** Most files in this repo are CRLF. A replacement written with `\n`
   silently matches nothing and reports success. Check with `repr()`.

8. **The user's machine is part of the system.** "The AI has no voice" was
   Windows being muted at 20%. The app had generated and played 79 seconds of
   audio, logged in `client.log`. Check the environment before the code.

---

## 3. What exists

**A desktop app** (Python/FastAPI backend, React frontend, PyInstaller, Inno
Setup), **an Android APK** (Capacitor), **a CLI**, **a VS Code extension**
(`vscode-extension/`, published as `shashwatmishra.smaran-ai-codex`), a
**marketing site** (`website/`, Netlify) and an **analytics dashboard**.

### Releases

Releases go to a **separate repository**: `SHASHWAT-MISHRA-997/SMARAN.AI-downloads`.
The main repo's own releases stop at v2.8.2 and that is expected.

Pushing a `v*` tag runs `.github/workflows/release.yml`, which builds Windows,
Linux and Android and publishes the release by itself. This works — five
secrets are set and each has been exercised, not merely present:

```
ANDROID_KEYSTORE_BASE64  ANDROID_KEYSTORE_PASSWORD
ANDROID_KEY_ALIAS        ANDROID_KEY_PASSWORD
DOWNLOADS_REPO_TOKEN
```

There is a 20-second check for the last one: Actions → **Check the downloads
token** → Run workflow. Use it before assuming the token is fine; a read-only
token passes every read.

To cut a release: bump the version in **six** files, build the frontend, commit,
push `main` **first**, then push the tag.

```
backend/app/updates.py            backend/app/usage_reporting.py
cli/smaran_cli/__init__.py        frontend/package.json
installer/SMARAN.AI.iss           frontend/android/app/build.gradle  (versionName AND versionCode)
```

The frontend build needs both analytics variables or reporting is silently
disabled in that build:

```bash
cd frontend && VITE_ANALYTICS_URL="https://smaran-analytics.netlify.app/ingest" \
  VITE_ANALYTICS_KEY="$(tr -d ' \r\n' < ../smaran-analytics/ingest-key.txt)" npm run build
```

### The website

`website/` is deployed **by hand**. Editing and pushing changes nothing.

```bash
cd website && python stamp.py
npx netlify-cli deploy --prod --no-build --dir=. --site=dc3a6e25-c361-48c9-b532-ab0b3b2c8443
```

---

## 4. Open work, most important first

### 4.1 Nothing that was fixed today is in anybody's hands

- **App**: released **2.10.32**; the repo has **four commits after it**,
  unreleased. The owner is still running **2.10.22** — none of the voice,
  dictation, GPU, update-check or call fixes are on their machine.
- **Extension**: repo is **2.20.0**, marketplace has **2.19.0**. The parser fix
  that makes the agent work at all with their model is **not published**.

**First task: get these out and confirm they arrived.** A fix nobody has is not
a fix.

### 4.2 Unverified — nobody has run these

Everything below was measured or exercised in isolation and **never used in
anger**. Treat each as unproven:

- Voice on the phone (no Android device was available)
- The three Speak paths that used to end in silence (the app is PIN-locked, so
  the UI was never driven)
- Sites with a working provider key (all four keys are dead — see 4.4)
- The GPU speed inside the running app (measured at library level only)
- The whole VS Code extension inside the extension host (modules were driven
  directly with Node)

### 4.3 Known and unfixed

- **The Windows app is not code-signed.** On Windows 11 with Smart App Control
  there is no "run anyway". This is the biggest barrier to giving it to a
  client. SignPath Foundation signs open-source builds free and requires a
  trusted build system, which the GitHub Actions build now satisfies. Nobody
  has applied.
- **`<tool_calls>` leaking into the transcript** — the panel now refuses to
  render bare markup, which is a guard, not a diagnosis. The path that produces
  it was never found. If you can reproduce it, find the real source.
- **"It mutes itself when I press Start talking"** — not explained. The system
  mute is reachable from speech: the intent pattern matches the bare word
  `mute` anywhere in an utterance (`backend/app/desktop_agent.py`, the
  `INTENT_PATTERNS` list). Mis-heard speech reaching it is plausible and
  unproven — nothing in the machine's logs shows a desktop command firing.
  Every spoken turn is sent to `/api/desktop/voice-command` **before** the chat
  model, so the surface is real.

### 4.4 The environment, as measured

- **All four cloud keys fail.** Anthropic: invalid. Gemini: free-tier quota
  exhausted, and Pro models have no free tier at all (`limit: 0`). OpenRouter:
  "User not found". NVIDIA: lists 81 models, all 404.
- **Ollama holds only `nomic-embed-text`** — an embedding model. There is no
  local model that can write a sentence.
- Together these mean **Sites and anything needing a model cannot be tested
  here.** Do not conclude a feature is broken when the cause is that nothing can
  answer.
- **Windows audio is muted at 20%.** Check this before investigating "no
  sound".
- The Android signing keystore is at `frontend/android/keystore/` with
  `keystore.properties` beside it. **Both are git-ignored and exist only on
  this machine.** If they are lost, no future build can update an existing
  install — Android refuses an APK signed with a different key. They should be
  backed up.

### 4.5 Asked for and not built

- The extension panel: a **diff before applying** (the diff is shown after) and
  richer progress
- The browser tools cannot **scroll** or **wait for an element**
- The owner asks for "full AGI". Be straight with them about what is and is not
  possible rather than agreeing.

---

## 5. How to work in this repo

- **Comments explain why, not what.** Look at any file here: they describe the
  failure that made the code necessary, in plain prose, often naming the
  measurement. Match that. Do not write `// set the flag`.
- **Commit messages are the same.** State the defect, the cause, the evidence,
  and what is still unknown.
- **Never handle the owner's credentials.** API keys, the signing keystore, the
  marketplace token — tell them what to run and let them run it.
- The app is PIN-locked. You cannot drive its UI. Do not ask for the PIN.
- `data/` under the repo is the dev instance; the installed app uses
  `%LOCALAPPDATA%\SMARAN.AI\data`, and `client.log` there is genuinely useful —
  it is how the muted-Windows finding was made.

### Verifying things

- Backend: `cd backend && python -m pytest tests -q` (50 tests)
- Frontend: `cd frontend && npx oxlint src/...` then `npm run build`
- Extension: `cd vscode-extension && npm run compile`, then drive the compiled
  modules directly with `node -e` — that is how the browser, diff and delegate
  work was checked
- Package the extension and **look inside it**: `npx @vscode/vsce ls`

---

## 6. The one thing to take from this

Every real bug found here was found by running something, and every one had
already passed a reading. The parser that made the agent do nothing looked
correct. The depth limit looked correct. The packaging looked correct.

So: build the thing, run the thing, read what it actually said, and report that
— including when it contradicts you.
