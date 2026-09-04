; ============================================================================
;  SMARAN.AI — Windows Installer (Inno Setup)
;  Produces SMARAN.AI-Setup.exe: a normal double-click installer that puts the
;  app in Program Files, adds Start Menu / Desktop shortcuts, and registers a
;  clean uninstaller. No Docker, no account, no licence key.
;
;  Build:
;    1. python build_exe.py                 (creates dist\SMARAN.AI\)
;    2. "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer\SMARAN.AI.iss
;  Output: installer\output\SMARAN.AI-Setup.exe
; ============================================================================

#define AppName        "SMARAN.AI"
#define AppVersion     "2.10.22"
#define AppPublisher   "SMARAN AI"
#define AppExeName     "SMARAN.AI.exe"
#define SourceDir      "..\dist\SMARAN.AI"

[Setup]
AppId={{9F1C7E20-4B3D-4C55-9A67-2E1D5B8C4A11}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
; Per-user install by default: no admin prompt, fewer AV false positives.
PrivilegesRequiredOverridesAllowed=dialog
PrivilegesRequired=lowest
OutputDir=output
OutputBaseFilename={#AppName}-Setup
SetupIconFile=..\smaran.ico
UninstallDisplayIcon={app}\{#AppExeName}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional shortcuts:"

[Files]
; The whole PyInstaller folder build: the EXE plus its _internal payload.
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExeName}"
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExeName}"; Description: "Launch {#AppName} now"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Remove only caches the app generates inside its own folder; user data in
; %LOCALAPPDATA%\SMARAN.AI is deliberately preserved across uninstalls.
Type: filesandordirs; Name: "{app}\__pycache__"
