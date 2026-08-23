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

## Before it goes live — the download links

The two download buttons point at GitHub Releases:

```
https://github.com/SHASHWAT-MISHRA-997/SMARAN.AI/releases/latest/download/SMARAN.AI-Setup.exe
https://github.com/SHASHWAT-MISHRA-997/SMARAN.AI/releases/latest/download/SMARAN.AI.apk
```

**These 404 right now.** The `SMARAN.AI` repository is not public, so there is
no release for them to resolve to. Two things have to be true before the
buttons work:

1. The repository is public.
2. A release exists whose attached files are named exactly
   `SMARAN.AI-Setup.exe` and `SMARAN.AI.apk`.

To publish a release with the current builds:

```bash
gh release create v2.8.2 dist-release/SMARAN.AI-Setup.exe dist-release/SMARAN.AI.apk --title "SMARAN.AI 2.8.2" --notes "Windows installer and Android APK."
```

GitHub Releases is the right home for these files: it accepts up to 2 GB per
file and serves them free, which neither Netlify nor Vercel will do for a
233 MB installer on a free plan.

If you would rather not make the repository public, put the two files on any
host that serves a direct link and change the two `href`s in `index.html` —
search for `releases/latest/download`.

## Deploying

Both configs are already in the folder, and neither host needs a build command.

**Netlify** — drag the `website` folder onto <https://app.netlify.com/drop>,
or connect the repo and set the base directory to `website`.

**Vercel** — `vercel --cwd website`, or connect the repo and set the root
directory to `website`.

**GitHub Pages** — push the folder to a `gh-pages` branch, or point Pages at
`/website` on `main`. Note that Pages ignores `netlify.toml` and `vercel.json`,
so the security headers will not apply there.

## Things worth knowing before editing

- **Nothing is fingerprinted**, so `netlify.toml` caches CSS and JS for an hour
  rather than a year. Raise it once you stop changing them daily.
- **The "screens" in the showcase are CSS, not screenshots.** They stay in
  scale on every viewport, weigh nothing, and never show a stale build of the
  interface. If you swap in real screenshots, remember they need retaking every
  time the UI moves.
- **Every animation is decorative.** `prefers-reduced-motion` switches all of
  it off, and the page still reads correctly — keep it that way.
- **The version number appears twice**: the hero pill and the footer. Search
  for `2.8.2`.
## Every number on the page, and where it comes from

Nothing here is estimated. If you change any of these in the app, change them
here too — a landing page that overstates is worse than one that says less.

| Claim | Source of truth |
| --- | --- |
| 63 models | `len(MODELS_CATALOG)` in `backend/app/models_catalog.py` |
| 9 screen sizes tested | the viewport list in `frontend/tests/visual/responsive.spec.js` |
| 3 platforms shipped | Windows installer, Android APK, VS Code extension |
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
