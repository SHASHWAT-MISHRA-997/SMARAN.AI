# SMARAN.AI — download site

A static landing page. Three files and a logo: no framework, no build step, no
dependencies. Any free static host will serve it as-is.

```
index.html    markup
styles.css    all styling and animation
main.js       scroll reveals, counters, particle field, menu
assets/       logo and favicon
```

## Look at it locally

```bash
python -m http.server 8899
```

Then open <http://127.0.0.1:8899>.

## Where the downloads come from

The source repository is **private**. Release assets are only publicly
downloadable from a public repository, so the builds live in a separate one
that holds nothing else:

```
https://github.com/SHASHWAT-MISHRA-997/SMARAN.AI-downloads
```

Publishing a new build:

```bash
gh release create vX.Y.Z dist-release/SMARAN.AI-Setup.exe dist-release/SMARAN.AI.apk   --repo SHASHWAT-MISHRA-997/SMARAN.AI-downloads --title "SMARAN.AI X.Y.Z"
```

The file names matter: the page links to `releases/latest/download/<name>`, so
they have to stay `SMARAN.AI-Setup.exe` and `SMARAN.AI.apk`.

GitHub Releases is the right home for these: it accepts up to 2 GB per file
and serves them free, which neither Netlify nor Vercel will do for a 233 MB
installer on a free plan.

**Order matters when changing visibility.** Confirm the downloads repo is
serving before locking anything else down — a private repository's release
assets 404 for everyone, which silently breaks every download button.

## Deploying

Both configs are already in the folder, and neither host needs a build command.

**Netlify** — deploy this folder, not the repository root. The root holds
`.git`, `node_modules` and the build outputs, which together are several
gigabytes and will fail the upload. Drag this folder onto
<https://app.netlify.com/drop>, run `netlify deploy --prod --dir .` from
inside it, or connect the repo through Git with the base directory set to
`website`.

**Vercel** — `vercel --cwd website`, or connect the repo and set the root
directory to `website`.

**GitHub Pages** — push the folder to a `gh-pages` branch, or point Pages at
`/website` on `main`. Note that Pages ignores `netlify.toml` and `vercel.json`,
so the security headers will not apply there.

## Things worth knowing before editing

- **Nothing is fingerprinted**, so `netlify.toml` caches CSS and JS for an hour
  rather than a year. Raise it once you stop changing them daily.
- **The mock screens are CSS, not screenshots**, and they animate: the hub
  cycles its filters, the chat answers, the call changes state. Each loop only
  runs while its screen is on the viewport.
- **The "screens" in the showcase are CSS, not screenshots.** They stay in
  scale on every viewport, weigh nothing, and never show a stale build of the
  interface. If you swap in real screenshots, remember they need retaking every
  time the UI moves.
- **Motion is always on**, by the owner's decision. The stylesheet still
  carries `prefers-reduced-motion` rules for anyone who loads the page without
  the script, but `main.js` asserts `motion-full` on the document.
- **No version number is shown on the page**, by the owner's decision. The
  release tag still carries one; the site deliberately does not, so it cannot
  go stale between builds.

## Every number on the page, and where it comes from

Nothing here is estimated. If you change any of these in the app, change them
here too — a landing page that overstates is worse than one that says less.

| Claim | Source of truth |
| --- | --- |
| 63 models | `len(MODELS_CATALOG)` in `backend/app/models_catalog.py` |
| 9 screen sizes tested | the viewport list in `frontend/tests/visual/responsive.spec.js` |
| 3 platforms shipped | Windows installer, Android APK, VS Code extension |
| No version shown | Deliberate: the release tag carries it, the page does not |
| 233 MB / 31 MB | `dist-release/SMARAN.AI-Setup.exe` and `SMARAN.AI.apk` |
| Android 7.0+ | `minSdkVersion = 24` in `frontend/android/variables.gradle` |
| 64-bit Windows | `ArchitecturesAllowed=x64compatible` in `installer/*.iss` |
| 4 GB / 8 GB / 512 GB | `ram_gb_req` across the catalogue: lowest 4, highest 512, 18 entries at 8 or less |

Claims that were on an earlier draft and have been **removed because the code
does not back them**:

- *"History searchable back to the first message"* — there is no conversation
  search in the frontend.
- *"Cites the passage it used" / "with the source attached"* — RAG passes
  passages to the model but no citation reaches the interface.
- *"It brings its own model runtime"* — the installer ships the PyInstaller
  build only. `bootstrapper.py` resolves a **user-installed** Ollama, so Ollama
  is a separate prerequisite and the page now says so.
- *"about four minutes"*, *"8 GB memory to be comfortable"*, *"6 GB free
  disk"* — invented figures with nothing behind them.
