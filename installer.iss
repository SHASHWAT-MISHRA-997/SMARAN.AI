; ═══════════════════════════════════════════════════════════════════
; SMARAN.AI — Windows Installer Setup Script (Inno Setup 6)
; ═══════════════════════════════════════════════════════════════════

[Setup]
AppName=SMARAN.AI
AppVersion=1.0.0
AppPublisher=SMARAN AI
AppPublisherURL=https://shashwatmishra-portfolio.netlify.app/
DefaultDirName={autopf}\SMARAN.AI
DefaultGroupName=SMARAN.AI
UninstallDisplayIcon={app}\SMARAN.AI.exe
Compression=lzma2/max
SolidCompression=yes
OutputDir=SMARAN_AI_Software_Release
OutputBaseFilename=SMARAN_AI_Setup_v1.0.0
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "SMARAN_AI_Software_Release\payload\SMARAN.AI.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\SMARAN.AI"; Filename: "{app}\SMARAN.AI.exe"
Name: "{autodesktop}\SMARAN.AI"; Filename: "{app}\SMARAN.AI.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\SMARAN.AI.exe"; Description: "{cm:LaunchProgram,SMARAN.AI}"; Flags: nowait postinstall skipifsilent
