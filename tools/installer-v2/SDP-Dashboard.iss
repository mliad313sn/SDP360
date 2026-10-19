; =============================================================================
; SDP Dashboard Setup — Inno Setup 6 script (Step 5, 2026-10-19).
;
; Seven screens: 1 Welcome + licence · 2 Detection of an existing installation ·
; 3 Mode (new / update / repair) · 4 Folders & port · 5 PostgreSQL (embedded or
; existing, masked password) · 6 Service account & TLS certificate · 7 Summary → progress.
;
; The wizard never edits the application itself: every system action goes through
; tools\installer-v2\post-install.js (write .env, npm ci --omit=dev, db\migrate.js,
; pm2 service, health probe). Before an UPDATE it runs tools\sdp-manager.js backup, and
; a failed post-install triggers `sdp-manager rollback`. All text is ASCII on purpose
; (Inno reads the script as ANSI unless saved UTF-8 with BOM).
;
; Build (CI, release.yml): iscc /DAppVersion=%VERSION% /DPackageZip=dist\sdp-dashboard-%VERSION%.zip
;                               /DNodeMsi=payload\node-v22-x64.msi /DPgExe=payload\postgresql-17-x64.exe
;                               tools\installer-v2\SDP-Dashboard.iss
; Signing: SignTool is passed with /S "signtool=..." when the certificate secret exists.
; =============================================================================
#ifndef AppVersion
  #define AppVersion "0.0.0-dev"
#endif
#ifndef PackageZip
  #define PackageZip "..\..\dist\sdp-dashboard-" + AppVersion + ".zip"
#endif

[Setup]
AppId={{7E3C9B1A-5D2F-4B8E-9C61-SDPDASHBOARD}
AppName=SDP Dashboard
AppVersion={#AppVersion}
AppVerName=SDP Dashboard {#AppVersion}
AppPublisher=Endeavour Mining - Group IT
DefaultDirName=C:\Apps\SDP-Dashboard
DefaultGroupName=SDP Dashboard
DisableProgramGroupPage=yes
LicenseFile=..\..\LICENSE
OutputDir=..\..\dist
OutputBaseFilename=SDP-Dashboard-Setup-{#AppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
SetupLogging=yes
; SignTool is only configured when CI has the certificate (see release.yml).
#ifdef SignTool
SignTool={#SignTool} $f
SignedUninstaller=yes
#endif

[Languages]
Name: "en"; MessagesFile: "compiler:Default.isl"
Name: "fr"; MessagesFile: "compiler:Languages\French.isl"

[Files]
; The signed update package is the ONLY source of application files — the same artefact
; the Manager applies for an update, so install and update can never diverge.
Source: "{#PackageZip}"; DestDir: "{tmp}"; DestName: "package.zip"; Flags: deleteafterinstall
Source: "post-install.js"; DestDir: "{app}\tools\installer-v2"; Flags: ignoreversion
; Optional embedded runtimes (CI puts them in payload\ when the release includes them).
#ifdef NodeMsi
Source: "{#NodeMsi}"; DestDir: "{tmp}"; DestName: "node.msi"; Flags: deleteafterinstall
#endif
#ifdef PgExe
Source: "{#PgExe}"; DestDir: "{tmp}"; DestName: "postgresql.exe"; Flags: deleteafterinstall
#endif

[Icons]
Name: "{group}\SDP Dashboard"; Filename: "http://localhost:{code:GetPort}/"
Name: "{group}\SDP Dashboard Manager"; Filename: "{app}\tools\manager\SDP-Dashboard-Manager.exe"; Check: FileExists(ExpandConstant('{app}\tools\manager\SDP-Dashboard-Manager.exe'))

[Run]
#ifdef NodeMsi
Filename: "msiexec.exe"; Parameters: "/i ""{tmp}\node.msi"" /qn /norestart"; StatusMsg: "Installing Node.js runtime..."; Check: NeedNode
#endif
#ifdef PgExe
Filename: "{tmp}\postgresql.exe"; Parameters: "--mode unattended --unattendedmodeui none --superpassword ""{code:GetPgSuperPassword}"" --serverport {code:GetPgPort} --servicename postgresql-x64-17"; StatusMsg: "Installing PostgreSQL 17..."; Check: NeedEmbeddedPg
#endif
; Backup before an update (sdp-manager uses PG_URL from the existing .env).
Filename: "{code:GetNode}"; Parameters: """{app}\tools\sdp-manager.js"" backup --dir ""{app}"""; WorkingDir: "{app}"; StatusMsg: "Backing up the database..."; Flags: runhidden; Check: IsUpdate
; Apply the package through the manager (verify manifest -> rollback point -> copy -> npm ci -> migrate).
Filename: "{code:GetNode}"; Parameters: """{app}\tools\installer-v2\post-install.js"" --dir ""{app}"" --package ""{tmp}\package.zip"" --mode {code:GetMode} --port {code:GetPort} --pg-host {code:GetPgHost} --pg-port {code:GetPgPort} --db-name {code:GetDbName} --db-user {code:GetDbUser} --service-account ""{code:GetServiceAccount}"" --cert-thumbprint ""{code:GetCertThumbprint}"""; WorkingDir: "{app}"; StatusMsg: "Configuring SDP Dashboard..."; Flags: runhidden waituntilterminated
Filename: "http://localhost:{code:GetPort}/"; Description: "Open SDP Dashboard"; Flags: postinstall shellexec skipifsilent

[UninstallRun]
Filename: "{code:GetNode}"; Parameters: """{app}\tools\installer-v2\post-install.js"" --dir ""{app}"" --mode uninstall"; WorkingDir: "{app}"; Flags: runhidden; RunOnceId: "sdp-uninstall"

[Code]
var
  DetectPage: TOutputMsgMemoWizardPage;
  ModePage: TInputOptionWizardPage;
  DirsPage: TInputQueryWizardPage;
  PgPage: TInputOptionWizardPage;
  PgQueryPage: TInputQueryWizardPage;
  SvcPage: TInputQueryWizardPage;
  Existing: Boolean;
  ExistingVersion: String;

function FileRead(const Path: String): String;
var S: AnsiString;
begin
  Result := '';
  if LoadStringFromFile(Path, S) then Result := String(S);
end;

procedure Detect;
var Mf: String;
begin
  Existing := FileExists(ExpandConstant('{app}\manifest.json')) or FileExists(ExpandConstant('{app}\server.js'));
  ExistingVersion := '';
  if FileExists(ExpandConstant('{app}\manifest.json')) then begin
    Mf := FileRead(ExpandConstant('{app}\manifest.json'));
    { crude but dependency-free: "version": "X" }
    if Pos('"version"', Mf) > 0 then begin
      Mf := Copy(Mf, Pos('"version"', Mf) + 10, 40);
      Mf := Copy(Mf, Pos('"', Mf) + 1, 40);
      ExistingVersion := Copy(Mf, 1, Pos('"', Mf) - 1);
    end;
  end;
end;

procedure InitializeWizard;
begin
  { 2 — detection }
  DetectPage := CreateOutputMsgMemoPage(wpLicense, 'Existing installation', 'What Setup found on this computer',
    'Setup looked at the destination folder, the Windows services and PostgreSQL.', '');
  { 3 — mode }
  ModePage := CreateInputOptionPage(DetectPage.ID, 'Installation mode', 'What should Setup do?', '', True, False);
  ModePage.Add('New installation (empty folder, new database)');
  ModePage.Add('Update the existing installation (backup first, automatic rollback on failure)');
  ModePage.Add('Repair (re-apply the same version, keep data and settings)');
  { 4 — folders & port }
  DirsPage := CreateInputQueryPage(ModePage.ID, 'Folders and port', 'Where the dashboard lives and listens',
    'Data (databases, backups, logs) is kept apart from the application so updates never touch it.');
  DirsPage.Add('Data folder:', False);
  DirsPage.Add('Backup folder:', False);
  DirsPage.Add('HTTP port (behind IIS):', False);
  DirsPage.Values[0] := ExpandConstant('{app}\data');
  DirsPage.Values[1] := 'C:\Apps\SDP-Backups';
  DirsPage.Values[2] := '3456';
  { 5 — PostgreSQL }
  PgPage := CreateInputOptionPage(DirsPage.ID, 'PostgreSQL', 'Which database server?', '', True, False);
  PgPage.Add('Install the embedded PostgreSQL 17 (recommended on a dedicated server)');
  PgPage.Add('Use an existing PostgreSQL 13+ server');
  PgPage.Values[0] := True;
  PgQueryPage := CreateInputQueryPage(PgPage.ID, 'PostgreSQL connection', 'Server, database and application role',
    'The superuser password is used once, to create the role and the database; it is never written to disk.');
  PgQueryPage.Add('Host:', False);
  PgQueryPage.Add('Port:', False);
  PgQueryPage.Add('Database name:', False);
  PgQueryPage.Add('Application role:', False);
  PgQueryPage.Add('Superuser (postgres) password:', True);
  PgQueryPage.Values[0] := 'localhost';
  PgQueryPage.Values[1] := '5432';
  PgQueryPage.Values[2] := 'sdp_dashboard';
  PgQueryPage.Values[3] := 'sdp_app';
  { 6 — service account & certificate }
  SvcPage := CreateInputQueryPage(PgQueryPage.ID, 'Service and TLS', 'How the dashboard runs and is reached',
    'Leave the account empty to run the pm2 service as LocalSystem. The certificate thumbprint binds HTTPS in IIS (optional).');
  SvcPage.Add('Service account (DOMAIN\user, optional):', False);
  SvcPage.Add('Service account password:', True);
  SvcPage.Add('TLS certificate thumbprint (optional):', False);
end;

procedure CurPageChanged(CurPageID: Integer);
var Txt: String;
begin
  if CurPageID = DetectPage.ID then begin
    Detect;
    if Existing then begin
      Txt := 'An installation was found in ' + ExpandConstant('{app}') + #13#10;
      if ExistingVersion <> '' then Txt := Txt + 'Installed version: ' + ExistingVersion + #13#10
      else Txt := Txt + 'Installed version: unknown (no manifest.json — pre-2.0 installation)' + #13#10;
      Txt := Txt + 'Package version: {#AppVersion}' + #13#10#13#10 +
        'Choosing "Update" on the next screen keeps your .env, data and backups.';
      ModePage.Values[1] := True;
    end else begin
      Txt := 'No installation found in ' + ExpandConstant('{app}') + '.' + #13#10 + 'Package version: {#AppVersion}';
      ModePage.Values[0] := True;
    end;
    DetectPage.RichEditViewer.Text := Txt;
  end;
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := False;
  { update / repair: database already configured }
  if (PageID = PgPage.ID) or (PageID = PgQueryPage.ID) then Result := Existing and not ModePage.Values[0];
  if PageID = PgQueryPage.ID then Result := Result or PgPage.Values[0];
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if CurPageID = DirsPage.ID then begin
    if (StrToIntDef(DirsPage.Values[2], 0) < 1024) or (StrToIntDef(DirsPage.Values[2], 0) > 65535) then begin
      MsgBox('The port must be a number between 1024 and 65535.', mbError, MB_OK); Result := False;
    end;
  end;
  if (CurPageID = ModePage.ID) and ModePage.Values[0] and Existing then
    Result := MsgBox('The folder already contains an installation. A NEW installation keeps the files but you will have to point it at a NEW database on the next screen. Continue?', mbConfirmation, MB_YESNO) = IDYES;
  if (CurPageID = PgQueryPage.ID) and (PgQueryPage.Values[4] = '') and ModePage.Values[0] then begin
    MsgBox('The superuser password is required to create the role and the database.', mbError, MB_OK); Result := False;
  end;
end;

function UpdateReadyMemo(Space, NewLine, MemoUserInfoInfo, MemoDirInfo, MemoTypeInfo, MemoComponentsInfo, MemoGroupInfo, MemoTasksInfo: String): String;
begin
  Result := 'Mode: ' + GetMode('') + NewLine + 'Application: ' + ExpandConstant('{app}') + NewLine +
    'Data: ' + DirsPage.Values[0] + NewLine + 'Backups: ' + DirsPage.Values[1] + NewLine + 'Port: ' + DirsPage.Values[2] + NewLine;
  if PgPage.Values[0] then Result := Result + 'PostgreSQL: embedded 17 on port ' + GetPgPort('') + NewLine
  else Result := Result + 'PostgreSQL: ' + GetPgHost('') + ':' + GetPgPort('') + ' / ' + GetDbName('') + ' as ' + GetDbUser('') + NewLine;
  if Existing and not ModePage.Values[0] then Result := Result + 'A database backup is taken first; a failed update is rolled back automatically.' + NewLine;
end;

{ ---- values handed to post-install.js ---- }
function GetMode(P: String): String;
begin
  if ModePage.Values[1] then Result := 'update' else if ModePage.Values[2] then Result := 'repair' else Result := 'new';
end;
function IsUpdate: Boolean; begin Result := ModePage.Values[1]; end;
function GetPort(P: String): String; begin Result := DirsPage.Values[2]; end;
function NeedEmbeddedPg: Boolean; begin Result := PgPage.Values[0] and not (Existing and not ModePage.Values[0]); end;
function GetPgHost(P: String): String; begin if PgPage.Values[0] then Result := 'localhost' else Result := PgQueryPage.Values[0]; end;
function GetPgPort(P: String): String; begin if PgPage.Values[0] then Result := '5432' else Result := PgQueryPage.Values[1]; end;
function GetDbName(P: String): String; begin Result := PgQueryPage.Values[2]; end;
function GetDbUser(P: String): String; begin Result := PgQueryPage.Values[3]; end;
function GetPgSuperPassword(P: String): String; begin Result := PgQueryPage.Values[4]; end;
function GetServiceAccount(P: String): String; begin Result := SvcPage.Values[0]; end;
function GetCertThumbprint(P: String): String; begin Result := SvcPage.Values[2]; end;
function NeedNode: Boolean;
var V: String;
begin
  Result := not RegQueryStringValue(HKLM, 'SOFTWARE\Node.js', 'Version', V) or (V < '22');
end;
function GetNode(P: String): String;
var Dir: String;
begin
  if RegQueryStringValue(HKLM, 'SOFTWARE\Node.js', 'InstallPath', Dir) then Result := AddBackslash(Dir) + 'node.exe'
  else Result := ExpandConstant('{pf}\nodejs\node.exe');
end;

{ Secrets are handed to post-install.js through the ENVIRONMENT, never on the command line
  (Windows event logs and process listings keep command lines). }
procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssInstall then begin
    SetEnvironmentVariable('SDP_SETUP_PGSUPERPASS', GetPgSuperPassword(''));
    SetEnvironmentVariable('SDP_SETUP_SVCPASS', SvcPage.Values[1]);
    SetEnvironmentVariable('SDP_SETUP_DATADIR', DirsPage.Values[0]);
    SetEnvironmentVariable('SDP_SETUP_BACKUPDIR', DirsPage.Values[1]);
  end;
end;
