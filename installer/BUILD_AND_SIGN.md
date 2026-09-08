# SMARAN.AI — Desktop Build, Installer & Code Signing

How to turn the source tree into `SMARAN.AI-Setup.exe` that any Windows user can
double-click. No Docker, no Python, no account, no licence key.

---

## 1. Build the app

```bash
cd frontend && npx vite build && cd ..
python build_exe.py
```

Output: `dist\SMARAN.AI\SMARAN.AI.exe` (plus its `_internal` payload folder).

The launcher (`desktop_app.py`) starts the bundled backend in-process and waits
for its health check before opening the window. If startup fails, it reports
the failure instead of opening a page backed by an unavailable engine.

User data (database, uploads, models, vector store) lives in
`%LOCALAPPDATA%\SMARAN.AI\data`, so it survives upgrades and uninstalls.

## 2. Build the installer

Install [Inno Setup 6](https://jrsoftware.org/isdl.php) (free), then:

```bash
"C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer\SMARAN.AI.iss
```

Output: `installer\output\SMARAN.AI-Setup.exe`.

It installs per-user by default (no admin prompt), adds Start Menu and optional
desktop shortcuts, and registers a proper uninstaller.

---

## 3. Code signing — why you need it

Windows blocks or warns on unsigned executables:

| Protection | Unsigned result |
|---|---|
| **Smart App Control** | Silently blocks the app (`WinError 4551`) |
| **SmartScreen** | "Windows protected your PC" warning; user must click "More info → Run anyway" |
| **Some antivirus** | PyInstaller apps are a common false-positive |

The result depends on the destination device's policy and reputation checks.
Do not infer the current machine's policy from this document. Signing identifies
the publisher but does not guarantee that every device will allow a release.

### Verify the policy state

```powershell
Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy' | Select VerifiedAndReputablePolicyState
```

`0` = Off, `1` = Enforced, `2` = Evaluation.

### Options

**A. Sign it (the real fix — do this before distributing).**

Use an appropriate code-signing identity and secure key storage from your
certificate provider. Verify its current issuance and storage requirements.
An OV or EV certificate does not guarantee instant SmartScreen trust.

Then sign **both** the app EXE and the installer:

```bash
signtool sign /tr http://timestamp.digicert.com /td sha256 /fd sha256 ^
  /a "dist\SMARAN.AI\SMARAN.AI.exe"

signtool sign /tr http://timestamp.digicert.com /td sha256 /fd sha256 ^
  /a "installer\output\SMARAN.AI-Setup.exe"

signtool verify /pa /v "installer\output\SMARAN.AI-Setup.exe"
```

`signtool` ships with the Windows SDK. Always timestamp (`/tr`) so signatures
stay valid after the certificate expires.

To sign automatically during the Inno build, add to `[Setup]`:

```
SignTool=mysigntool
SignedUninstaller=yes
```

and define `mysigntool` in Inno Setup's *Tools → Configure Sign Tools*.

**B. Testing on your own machine only (not for users).**

Use an isolated test VM with an appropriate development policy. Do not ask
end users to disable their device's application-control protections.

A self-signed certificate does **not** remove warnings for other users; it only
helps if they manually trust your certificate.

---

## 4. Distribution checklist

- [ ] `npx vite build` run so the bundled UI is current
- [ ] `python build_exe.py` completed with exit code 0
- [ ] App launches and the window opens (no dead-port error)
- [ ] Installer built with Inno Setup
- [ ] **App EXE and installer both signed and timestamped**
- [ ] `signtool verify /pa` passes
- [ ] Tested on a clean Windows VM (no Python, no Docker)
- [ ] Submit to [Microsoft's false-positive portal](https://www.microsoft.com/wdsi/filesubmission)
      if antivirus flags it

---

## 5. Notes

- **Bundle size**: heavy transitive dependencies (torch, transformers, polars,
  faiss, sklearn, onnxruntime) are excluded in `build_exe.py` because SMARAN.AI
  never imports them — embeddings run through Ollama.
- **Desktop control** (opening apps, screenshots, system info) works natively
  here, unlike the Docker build which cannot reach the Windows host.
- **Offline**: the app starts with no internet. Model responses need whatever
  runtime the user configures (local Ollama, or their own API key).
