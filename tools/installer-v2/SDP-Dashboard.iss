; =============================================================================
; SDP Dashboard Setup — Inno Setup 6 script, installer v2.1 (2026-10-29).
;
; One Setup.exe installs, updates, repairs and uninstalls. Modern wizard (EN / FR):
;   Welcome · Licence · Folder · What Setup found · Mode (new / update / repair) ·
;   [Unsigned package warning] · Data, backups and port · PostgreSQL · Service account ·
;   Public address (IIS, optional) · Summary · Progress · Finish (open the dashboard / the Manager).
;
; Everything is offline: the Node.js runtime, the dependencies built for Windows (node_modules), the
; Windows service host and the Manager are in the payload (tools/installer-v2/build.ps1 builds it).
; The wizard never edits the application: post-install.js does every system action and is checked by
; exit code — a failure stops Setup, rolls the files back, and names the log.
;
; Silent install (all wizard values have a /PARAM; secrets ONLY through environment variables):
;   set SDP_SETUP_PGSUPERPASS=...            (new installation: PostgreSQL superuser password)
;   set SDP_SETUP_SVCPASS=...                (optional: password of /SERVICEACCOUNT)
;   SDP-Dashboard-Setup-<v>.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /LOG=setup.log
;       /DIR="C:\Apps\SDP-Dashboard" /MODE=new|update|repair /PORT=3456 /DATADIR=... /BACKUPDIR=...
;       /PGHOST=localhost /PGPORT=5432 /DBNAME=sdp_dashboard /DBUSER=sdp_app /SERVICEACCOUNT=DOMAIN\user
;       /PUBLICHOST=itops.example.com /THUMBPRINT=<sha1> [/ALLOWUNSIGNED=1]
;   Uninstall: unins000.exe /VERYSILENT [/REMOVEDATA=1]   (data, backups and .env are KEPT by default)
;
; Build: tools/installer-v2/build.ps1 (CI: .github/workflows/installer.yml and release.yml).
; All text is ASCII except the French messages, which Inno reads as UTF-8 (file saved with BOM).
; =============================================================================
#ifndef AppVersion
  #define AppVersion "0.0.0-dev"
#endif
#ifndef PackageZip
  #define PackageZip "..\..\dist\sdp-dashboard-" + AppVersion + ".zip"
#endif
#ifndef PayloadDir
  #define PayloadDir "..\..\dist\payload"
#endif
#ifndef PackageSigned
  #define PackageSigned "0"
#endif
#ifndef FileVersion
  #define FileVersion "0.0.0.0"
#endif

[Setup]
AppId={{7E3C9B1A-5D2F-4B8E-9C61-SDPDASHBOARD}
AppName=SDP Dashboard
AppVersion={#AppVersion}
AppVerName=SDP Dashboard {#AppVersion}
AppPublisher=Endeavour Mining - Group IT
AppSupportURL=https://itops-dashboard.edv-ops.com/help.html
DefaultDirName=C:\Apps\SDP-Dashboard
DefaultGroupName=SDP Dashboard
DisableProgramGroupPage=yes
DisableDirPage=auto
UsePreviousAppDir=yes
LicenseFile=..\..\LICENSE
OutputDir=..\..\dist
OutputBaseFilename=SDP-Dashboard-Setup-{#AppVersion}
SetupIconFile=assets\sdp.ico
UninstallDisplayIcon={app}\manager\SdpDashboardManager.exe
UninstallDisplayName=SDP Dashboard {#AppVersion}
WizardStyle=modern
WizardSizePercent=110
WizardImageFile=assets\wizard.bmp
WizardSmallImageFile=assets\wizard-small.bmp
Compression=lzma2/max
SolidCompression=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
SetupLogging=yes
CloseApplications=no
RestartApplications=no
VersionInfoVersion={#FileVersion}
VersionInfoCompany=Endeavour Mining - Group IT
VersionInfoDescription=SDP Dashboard Setup
#ifdef SignTool
SignTool={#SignTool} $f
SignedUninstaller=yes
#endif

[Languages]
Name: "en"; MessagesFile: "compiler:Default.isl"
Name: "fr"; MessagesFile: "compiler:Languages\French.isl"

[CustomMessages]
en.FoundTitle=What Setup found
en.FoundSub=Existing installation on this computer
en.ModeTitle=What should Setup do?
en.ModeSub=Choose the operation
en.ModeNew=New installation (new database)
en.ModeUpdate=Update the installed version (database backed up first, automatic roll back on failure)
en.ModeRepair=Repair (re-apply this version, keep data and settings)
en.UnsignedTitle=This package is not signed
en.UnsignedSub=Its origin cannot be proven
en.UnsignedText=This Setup was built without the signing key. Install it only if you built it yourself or received it from Group IT through a trusted channel. Your choice is recorded in the installation log.
en.UnsignedAccept=I understand and want to install this unsigned package
en.DirsTitle=Data, backups and port
en.DirsSub=Data is kept apart from the application, so updates never touch it
en.DataDir=Data folder:
en.BackupDir=Backup folder (ideally on another disk):
en.Port=Local port (reached through IIS, never from the network):
en.PgTitle=Database (PostgreSQL)
en.PgSub=Server, database and application account
en.PgText=The superuser password is used once, to create the application account and the database. It is never written to disk.
en.PgEmbedded=Install PostgreSQL 17 on this server (recommended on a dedicated server)
en.PgExisting=Use an existing PostgreSQL 13+ server
en.PgHost=Server:
en.PgPort=Port:
en.DbName=Database name:
en.DbUser=Application account:
en.PgSuper=Superuser (postgres) password:
en.SvcTitle=Windows service
en.SvcSub=The dashboard runs as the service "SDP Dashboard", starts with Windows and restarts after a failure
en.SvcText=Leave the account empty to run as Local System. A domain account is needed only when the dashboard must read a network share (off-site backups).
en.SvcAccount=Service account (DOMAIN\user, optional):
en.SvcPassword=Password of that account:
en.IisTitle=Public address (optional)
en.IisSub=Publish the dashboard through IIS with HTTPS
en.IisText=Needs IIS with URL Rewrite and Application Request Routing. Leave empty to configure IIS later (docs\INTERNAL_TLS_SETUP.md). The dashboard itself never listens on the network.
en.IisHost=Host name (e.g. itops-dashboard.edv-ops.com):
en.IisThumb=Certificate thumbprint (LocalMachine\My):
en.Configuring=Configuring SDP Dashboard (database, service, health check)...
en.InstallingPg=Installing PostgreSQL 17...
en.PostFailed=SDP Dashboard could not be configured: %1%n%nNothing was left half-done: the previous files are put back. Details:%n%2
en.OpenDashboard=Open SDP Dashboard
en.OpenManager=Open SDP Dashboard Manager
en.ManagerIcon=SDP Dashboard Manager
en.LogsIcon=SDP Dashboard logs
en.RemoveData=Also delete the data, the backups and the settings (.env)?%n%nChoose No to keep them (recommended): a later installation in the same folder finds them again.
en.PortBad=The port must be a number between 1024 and 65535.
en.SuperNeeded=The superuser password is required to create the database.
en.NewOverExisting=This folder already holds an installation. A NEW installation keeps its files and needs a NEW database. Continue?
en.Unsigned=Accept the unsigned package to continue.
fr.FoundTitle=Ce que l'installation a trouvé
fr.FoundSub=Installation existante sur cet ordinateur
fr.ModeTitle=Que doit faire l'installation ?
fr.ModeSub=Choisissez l'opération
fr.ModeNew=Nouvelle installation (nouvelle base de données)
fr.ModeUpdate=Mettre à jour la version installée (base sauvegardée d'abord, retour arrière automatique en cas d'échec)
fr.ModeRepair=Réparer (réappliquer cette version, garder données et réglages)
fr.UnsignedTitle=Ce paquet n'est pas signé
fr.UnsignedSub=Son origine ne peut pas être prouvée
fr.UnsignedText=Cette installation a été construite sans la clé de signature. Ne l'installez que si vous l'avez construite vous-même ou reçue de l'IT Groupe par un canal de confiance. Votre choix est noté dans le journal d'installation.
fr.UnsignedAccept=Je comprends et je veux installer ce paquet non signé
fr.DirsTitle=Données, sauvegardes et port
fr.DirsSub=Les données sont séparées de l'application : une mise à jour n'y touche jamais
fr.DataDir=Dossier des données :
fr.BackupDir=Dossier des sauvegardes (idéalement sur un autre disque) :
fr.Port=Port local (atteint par IIS, jamais depuis le réseau) :
fr.PgTitle=Base de données (PostgreSQL)
fr.PgSub=Serveur, base et compte applicatif
fr.PgText=Le mot de passe du superutilisateur sert une seule fois, à créer le compte applicatif et la base. Il n'est jamais écrit sur le disque.
fr.PgEmbedded=Installer PostgreSQL 17 sur ce serveur (recommandé sur un serveur dédié)
fr.PgExisting=Utiliser un serveur PostgreSQL 13+ existant
fr.PgHost=Serveur :
fr.PgPort=Port :
fr.DbName=Nom de la base :
fr.DbUser=Compte applicatif :
fr.PgSuper=Mot de passe du superutilisateur (postgres) :
fr.SvcTitle=Service Windows
fr.SvcSub=Le tableau de bord tourne comme service « SDP Dashboard », démarre avec Windows et redémarre après une panne
fr.SvcText=Laissez le compte vide pour utiliser Système local. Un compte de domaine n'est utile que pour écrire sur un partage réseau (sauvegardes hors site).
fr.SvcAccount=Compte de service (DOMAINE\utilisateur, facultatif) :
fr.SvcPassword=Mot de passe de ce compte :
fr.IisTitle=Adresse publique (facultatif)
fr.IisSub=Publier le tableau de bord par IIS en HTTPS
fr.IisText=Nécessite IIS avec URL Rewrite et Application Request Routing. Laissez vide pour configurer IIS plus tard (docs\INTERNAL_TLS_SETUP.md). Le tableau de bord n'écoute jamais le réseau lui-même.
fr.IisHost=Nom d'hôte (ex. itops-dashboard.edv-ops.com) :
fr.IisThumb=Empreinte du certificat (LocalMachine\My) :
fr.Configuring=Configuration de SDP Dashboard (base, service, contrôle de santé)...
fr.InstallingPg=Installation de PostgreSQL 17...
fr.PostFailed=SDP Dashboard n'a pas pu être configuré : %1%n%nRien n'est laissé à moitié fait : les fichiers précédents sont remis en place. Détails :%n%2
fr.OpenDashboard=Ouvrir SDP Dashboard
fr.OpenManager=Ouvrir le gestionnaire SDP Dashboard
fr.ManagerIcon=Gestionnaire SDP Dashboard
fr.LogsIcon=Journaux SDP Dashboard
fr.RemoveData=Supprimer aussi les données, les sauvegardes et les réglages (.env) ?%n%nChoisissez Non pour les garder (recommandé) : une installation ultérieure dans le même dossier les retrouve.
fr.PortBad=Le port doit être un nombre entre 1024 et 65535.
fr.SuperNeeded=Le mot de passe du superutilisateur est nécessaire pour créer la base.
fr.NewOverExisting=Ce dossier contient déjà une installation. Une NOUVELLE installation garde ses fichiers et demande une NOUVELLE base. Continuer ?
fr.Unsigned=Acceptez le paquet non signé pour continuer.

[Files]
; Runtime and dependencies built for Windows by CI — the install needs no internet.
Source: "{#PayloadDir}\runtime\node\*"; DestDir: "{app}\runtime\node"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#PayloadDir}\node_modules\*"; DestDir: "{app}\.setup\node_modules"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#PayloadDir}\service\*"; DestDir: "{app}\service"; Flags: ignoreversion recursesubdirs
Source: "{#PayloadDir}\manager\*"; DestDir: "{app}\manager"; Flags: ignoreversion recursesubdirs
; The bootstrap copy of the manager CLI that applies the package (the package then installs its own).
Source: "{#PayloadDir}\bootstrap\*"; DestDir: "{tmp}\bootstrap"; Flags: ignoreversion recursesubdirs createallsubdirs deleteafterinstall
; The signed update package is the ONLY source of application files — install and update never diverge.
Source: "{#PackageZip}"; DestDir: "{tmp}"; DestName: "package.zip"; Flags: deleteafterinstall
#ifdef PgExe
Source: "{#PgExe}"; DestDir: "{tmp}"; DestName: "postgresql.exe"; Flags: deleteafterinstall
#endif
Source: "iis-setup.ps1"; DestDir: "{app}\tools\installer-v2"; Flags: ignoreversion
; LAST entry: once everything above is on disk, configure the machine. A failure raises → Setup rolls back.
Source: "post-install.js"; DestDir: "{app}\tools\installer-v2"; Flags: ignoreversion; AfterInstall: RunPostInstall

[Icons]
Name: "{group}\SDP Dashboard"; Filename: "{code:GetUrl}"; IconFilename: "{app}\manager\SdpDashboardManager.exe"
Name: "{group}\{cm:ManagerIcon}"; Filename: "{app}\manager\SdpDashboardManager.exe"
Name: "{group}\{cm:LogsIcon}"; Filename: "{app}\logs"

[Run]
Filename: "{code:GetUrl}"; Description: "{cm:OpenDashboard}"; Flags: postinstall shellexec skipifsilent nowait
Filename: "{app}\manager\SdpDashboardManager.exe"; Description: "{cm:OpenManager}"; Flags: postinstall shellexec skipifsilent nowait unchecked

[UninstallRun]
Filename: "{app}\runtime\node\node.exe"; Parameters: """{app}\tools\installer-v2\post-install.js"" --dir ""{app}"" --mode uninstall"; WorkingDir: "{app}"; Flags: runhidden waituntilterminated; RunOnceId: "sdp-uninstall"

[Code]
function SetEnvironmentVariable(lpName, lpValue: String): Boolean;
  external 'SetEnvironmentVariableW@kernel32.dll stdcall';

var
  DetectPage: TOutputMsgMemoWizardPage;
  ModePage: TInputOptionWizardPage;
  UnsignedPage: TInputOptionWizardPage;
  DirsPage: TInputQueryWizardPage;
  PgModePage: TInputOptionWizardPage;
  PgPage: TInputQueryWizardPage;
  SvcPage: TInputQueryWizardPage;
  IisPage: TInputQueryWizardPage;
  Existing: Boolean;
  ExistingVersion: String;
  PostInstallFailed: Boolean;
  ServiceWasStopped: Boolean;

{ ---------- small helpers (declared before use: Pascal Script reads top to bottom) ---------- }
function Param(Name, Def: String): String;
begin
  Result := ExpandConstant('{param:' + Name + '|' + Def + '}');
end;

function FileText(const Path: String): String;
var S: AnsiString;
begin
  Result := '';
  if LoadStringFromFile(Path, S) then Result := String(S);
end;

function JsonValue(const Txt, Key: String): String;
var P: Integer; S: String;
begin
  Result := '';
  P := Pos('"' + Key + '"', Txt);
  if P = 0 then exit;
  S := Copy(Txt, P + Length(Key) + 2, 400);
  P := Pos('"', S); if P = 0 then exit;
  S := Copy(S, P + 1, 400);
  P := Pos('"', S); if P = 0 then exit;
  Result := Copy(S, 1, P - 1);
end;

function IsEmbeddedPgAvailable: Boolean;
begin
#ifdef PgExe
  Result := True;
#else
  Result := False;
#endif
end;

function GetMode(P: String): String;
begin
  if ModePage.Values[1] then Result := 'update'
  else if ModePage.Values[2] then Result := 'repair'
  else Result := 'new';
end;
function IsNew: Boolean; begin Result := ModePage.Values[0]; end;
function GetPort(P: String): String; begin Result := Trim(DirsPage.Values[2]); end;
function GetUrl(P: String): String; begin Result := 'http://localhost:' + GetPort(''); end;
function UseEmbeddedPg: Boolean; begin Result := IsNew and IsEmbeddedPgAvailable and PgModePage.Values[0]; end;
function GetPgHost(P: String): String; begin if UseEmbeddedPg then Result := 'localhost' else Result := Trim(PgPage.Values[0]); end;
function GetPgPort(P: String): String; begin Result := Trim(PgPage.Values[1]); end;
function GetDbName(P: String): String; begin Result := Trim(PgPage.Values[2]); end;
function GetDbUser(P: String): String; begin Result := Trim(PgPage.Values[3]); end;
function GetPgSuperPassword: String;
begin
  Result := PgPage.Values[4];
  if Result = '' then Result := GetEnv('SDP_SETUP_PGSUPERPASS');
end;
function GetSvcPassword: String;
begin
  Result := SvcPage.Values[1];
  if Result = '' then Result := GetEnv('SDP_SETUP_SVCPASS');
end;

procedure Detect;
var Mf: String;
begin
  Existing := FileExists(ExpandConstant('{app}\server.js')) or FileExists(ExpandConstant('{app}\manifest.json'));
  ExistingVersion := '';
  if FileExists(ExpandConstant('{app}\manifest.json')) then begin
    Mf := FileText(ExpandConstant('{app}\manifest.json'));
    ExistingVersion := JsonValue(Mf, 'version');
  end;
end;

{ ---------- wizard ---------- }
procedure InitializeWizard;
begin
  DetectPage := CreateOutputMsgMemoPage(wpSelectDir, CustomMessage('FoundTitle'), CustomMessage('FoundSub'), '', '');
  ModePage := CreateInputOptionPage(DetectPage.ID, CustomMessage('ModeTitle'), CustomMessage('ModeSub'), '', True, False);
  ModePage.Add(CustomMessage('ModeNew'));
  ModePage.Add(CustomMessage('ModeUpdate'));
  ModePage.Add(CustomMessage('ModeRepair'));

  UnsignedPage := CreateInputOptionPage(ModePage.ID, CustomMessage('UnsignedTitle'), CustomMessage('UnsignedSub'), CustomMessage('UnsignedText'), False, False);
  UnsignedPage.Add(CustomMessage('UnsignedAccept'));
  UnsignedPage.Values[0] := Param('ALLOWUNSIGNED', '0') = '1';

  DirsPage := CreateInputQueryPage(UnsignedPage.ID, CustomMessage('DirsTitle'), CustomMessage('DirsSub'), '');
  DirsPage.Add(CustomMessage('DataDir'), False);
  DirsPage.Add(CustomMessage('BackupDir'), False);
  DirsPage.Add(CustomMessage('Port'), False);
  DirsPage.Values[0] := Param('DATADIR', '');
  DirsPage.Values[1] := Param('BACKUPDIR', 'C:\Apps\SDP-Backups');
  DirsPage.Values[2] := Param('PORT', '3456');

  PgModePage := CreateInputOptionPage(DirsPage.ID, CustomMessage('PgTitle'), CustomMessage('PgSub'), '', True, False);
  PgModePage.Add(CustomMessage('PgEmbedded'));
  PgModePage.Add(CustomMessage('PgExisting'));
  if IsEmbeddedPgAvailable and (Param('PGHOST', '') = '') then PgModePage.Values[0] := True else PgModePage.Values[1] := True;

  PgPage := CreateInputQueryPage(PgModePage.ID, CustomMessage('PgTitle'), CustomMessage('PgSub'), CustomMessage('PgText'));
  PgPage.Add(CustomMessage('PgHost'), False);
  PgPage.Add(CustomMessage('PgPort'), False);
  PgPage.Add(CustomMessage('DbName'), False);
  PgPage.Add(CustomMessage('DbUser'), False);
  PgPage.Add(CustomMessage('PgSuper'), True);
  PgPage.Values[0] := Param('PGHOST', 'localhost');
  PgPage.Values[1] := Param('PGPORT', '5432');
  PgPage.Values[2] := Param('DBNAME', 'sdp_dashboard');
  PgPage.Values[3] := Param('DBUSER', 'sdp_app');

  SvcPage := CreateInputQueryPage(PgPage.ID, CustomMessage('SvcTitle'), CustomMessage('SvcSub'), CustomMessage('SvcText'));
  SvcPage.Add(CustomMessage('SvcAccount'), False);
  SvcPage.Add(CustomMessage('SvcPassword'), True);
  SvcPage.Values[0] := Param('SERVICEACCOUNT', '');

  IisPage := CreateInputQueryPage(SvcPage.ID, CustomMessage('IisTitle'), CustomMessage('IisSub'), CustomMessage('IisText'));
  IisPage.Add(CustomMessage('IisHost'), False);
  IisPage.Add(CustomMessage('IisThumb'), False);
  IisPage.Values[0] := Param('PUBLICHOST', '');
  IisPage.Values[1] := Param('THUMBPRINT', '');

  { silent installs: the mode comes from /MODE, else from what is on disk (read at the first step) }
  if Param('MODE', '') = 'update' then ModePage.Values[1] := True
  else if Param('MODE', '') = 'repair' then ModePage.Values[2] := True
  else ModePage.Values[0] := True;
end;

procedure CurPageChanged(CurPageID: Integer);
var Txt: String;
begin
  if CurPageID = DetectPage.ID then begin
    Detect;
    if Existing then begin
      Txt := ExpandConstant('{app}') + #13#10;
      if ExistingVersion <> '' then Txt := Txt + 'Installed version / version installée : ' + ExistingVersion + #13#10
      else Txt := Txt + 'Installed version / version installée : 1.x (no manifest.json)' + #13#10;
      Txt := Txt + 'This Setup / cette installation : {#AppVersion}' + #13#10#13#10 +
        'Update keeps .env, data and backups. / La mise à jour garde .env, les données et les sauvegardes.';
      if Param('MODE', '') = '' then ModePage.Values[1] := True;
    end else begin
      Txt := ExpandConstant('{app}') + #13#10 + 'No installation found. / Aucune installation trouvée.' + #13#10 +
        'This Setup / cette installation : {#AppVersion}';
      if Param('MODE', '') = '' then ModePage.Values[0] := True;
    end;
    DetectPage.RichEditViewer.Text := Txt;
  end;
  if (CurPageID = DirsPage.ID) and (DirsPage.Values[0] = '') then
    DirsPage.Values[0] := ExpandConstant('{app}\data');
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := False;
  if PageID = UnsignedPage.ID then Result := '{#PackageSigned}' = '1';
  { an update / repair keeps the database it has }
  if (PageID = PgModePage.ID) then Result := (not IsNew) or (not IsEmbeddedPgAvailable);
  if (PageID = PgPage.ID) then Result := not IsNew;
  if (PageID = SvcPage.ID) then Result := False;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var P: Integer;
begin
  Result := True;
  if (CurPageID = ModePage.ID) and IsNew and Existing and not WizardSilent then
    Result := MsgBox(CustomMessage('NewOverExisting'), mbConfirmation, MB_YESNO) = IDYES;
  if (CurPageID = UnsignedPage.ID) and not UnsignedPage.Values[0] then begin
    MsgBox(CustomMessage('Unsigned'), mbError, MB_OK); Result := False;
  end;
  if CurPageID = DirsPage.ID then begin
    P := StrToIntDef(GetPort(''), 0);
    if (P < 1024) or (P > 65535) then begin MsgBox(CustomMessage('PortBad'), mbError, MB_OK); Result := False; end;
  end;
  if (CurPageID = PgPage.ID) and IsNew and (GetPgSuperPassword = '') then begin
    MsgBox(CustomMessage('SuperNeeded'), mbError, MB_OK); Result := False;
  end;
end;

function UpdateReadyMemo(Space, NewLine, MemoUserInfoInfo, MemoDirInfo, MemoTypeInfo, MemoComponentsInfo, MemoGroupInfo, MemoTasksInfo: String): String;
begin
  Result := 'Mode: ' + GetMode('') + NewLine + MemoDirInfo + NewLine +
    'Data: ' + DirsPage.Values[0] + NewLine + 'Backups: ' + DirsPage.Values[1] + NewLine + 'Port: ' + GetPort('') + ' (127.0.0.1 only)' + NewLine;
  if IsNew then begin
    if UseEmbeddedPg then Result := Result + 'PostgreSQL: 17 installed on this server, port ' + GetPgPort('') + NewLine
    else Result := Result + 'PostgreSQL: ' + GetPgHost('') + ':' + GetPgPort('') + ' / ' + GetDbName('') + ' as ' + GetDbUser('') + NewLine;
  end else
    Result := Result + 'The database is backed up first; a failed update is rolled back automatically.' + NewLine;
  if SvcPage.Values[0] <> '' then Result := Result + 'Service account: ' + SvcPage.Values[0] + NewLine
  else Result := Result + 'Service: SDP Dashboard (Local System)' + NewLine;
  if IisPage.Values[0] <> '' then Result := Result + 'Public address: ' + IisPage.Values[0] + NewLine;
  if '{#PackageSigned}' <> '1' then Result := Result + 'WARNING: unsigned package (accepted).' + NewLine;
end;

{ ---------- install ---------- }
function PrepareToInstall(var NeedsRestart: Boolean): String;
var Rc: Integer;
begin
  Result := '';
  { the files of a running service are locked: stop it before copying (restarted by post-install) }
  if Exec(ExpandConstant('{sys}\sc.exe'), 'query SDPDashboard', '', SW_HIDE, ewWaitUntilTerminated, Rc) and (Rc = 0) then begin
    Exec(ExpandConstant('{sys}\net.exe'), 'stop SDPDashboard', '', SW_HIDE, ewWaitUntilTerminated, Rc);
    ServiceWasStopped := True;
    Sleep(3000);
  end;
end;

procedure InstallEmbeddedPg;
var Rc: Integer; Opt: String;
begin
  if not UseEmbeddedPg then exit;
  if RegKeyExists(HKLM, 'SYSTEM\CurrentControlSet\Services\postgresql-x64-17') then exit;
  WizardForm.StatusLabel.Caption := CustomMessage('InstallingPg');
  { the superuser password goes through an option file deleted right after — never a command line }
  Opt := ExpandConstant('{tmp}\pgopt.ini');
  SaveStringToFile(Opt, 'superpassword=' + GetPgSuperPassword + #13#10 + 'serverport=' + GetPgPort('') + #13#10, False);
  try
    if not Exec(ExpandConstant('{tmp}\postgresql.exe'), '--mode unattended --unattendedmodeui none --servicename postgresql-x64-17 --optionfile "' + Opt + '"', '', SW_HIDE, ewWaitUntilTerminated, Rc) or (Rc <> 0) then
      RaiseException('PostgreSQL 17 installation failed (exit ' + IntToStr(Rc) + ')');
  finally
    DeleteFile(Opt);
  end;
end;

procedure RunPostInstall;
var Rc: Integer; Args, LogPath, Last: String;
begin
  { the wizard's checks do not run in silent mode: enforce them here }
  if ('{#PackageSigned}' <> '1') and not UnsignedPage.Values[0] then RaiseException(CustomMessage('Unsigned') + ' (/ALLOWUNSIGNED=1)');
  if IsNew and (GetPgSuperPassword = '') then RaiseException(CustomMessage('SuperNeeded') + ' (SDP_SETUP_PGSUPERPASS)');
  { a silent install never shows the folders page, which is where the data folder default is filled }
  if Trim(DirsPage.Values[0]) = '' then DirsPage.Values[0] := ExpandConstant('{app}\data');
  InstallEmbeddedPg;
  WizardForm.StatusLabel.Caption := CustomMessage('Configuring');
  { secrets travel in the environment of the child process only }
  SetEnvironmentVariable('SDP_SETUP_PGSUPERPASS', GetPgSuperPassword);
  SetEnvironmentVariable('SDP_SETUP_SVCPASS', GetSvcPassword);
  SetEnvironmentVariable('SDP_SETUP_DATADIR', DirsPage.Values[0]);
  SetEnvironmentVariable('SDP_SETUP_BACKUPDIR', DirsPage.Values[1]);
  Args := '"' + ExpandConstant('{tmp}\bootstrap\tools\installer-v2\post-install.js') + '"' +
    ' --dir "' + ExpandConstant('{app}') + '" --package "' + ExpandConstant('{tmp}\package.zip') + '"' +
    ' --mode ' + GetMode('') + ' --port ' + GetPort('') +
    ' --node-modules "' + ExpandConstant('{app}\.setup\node_modules') + '"' +
    ' --pg-host ' + GetPgHost('') + ' --pg-port ' + GetPgPort('') + ' --db-name ' + GetDbName('') + ' --db-user ' + GetDbUser('');
  if SvcPage.Values[0] <> '' then Args := Args + ' --service-account "' + SvcPage.Values[0] + '"';
  if IisPage.Values[0] <> '' then Args := Args + ' --public-host ' + IisPage.Values[0] + ' --cert-thumbprint "' + IisPage.Values[1] + '"';
  if '{#PackageSigned}' <> '1' then Args := Args + ' --allow-unsigned';
  Log('post-install: ' + Args);
  if not Exec(ExpandConstant('{app}\runtime\node\node.exe'), Args, ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, Rc) then Rc := -1;
  SetEnvironmentVariable('SDP_SETUP_PGSUPERPASS', '');
  SetEnvironmentVariable('SDP_SETUP_SVCPASS', '');
  if Rc <> 0 then begin
    PostInstallFailed := True;
    Last := FileText(ExpandConstant('{app}\logs\setup-last.json'));
    LogPath := JsonValue(Last, 'log');
    RaiseException(FmtMessage(CustomMessage('PostFailed'), [JsonValue(Last, 'error'), LogPath]));
  end;
end;

procedure DeinitializeSetup;
var Rc: Integer;
begin
  { a failed update: the previous files are back (post-install + Setup's own roll back) — start the service again }
  if (PostInstallFailed or ServiceWasStopped) and Exec(ExpandConstant('{sys}\sc.exe'), 'query SDPDashboard', '', SW_HIDE, ewWaitUntilTerminated, Rc) and (Rc = 0) then
    Exec(ExpandConstant('{sys}\net.exe'), 'start SDPDashboard', '', SW_HIDE, ewWaitUntilTerminated, Rc);
end;

{ ---------- uninstall ---------- }
procedure DeleteAppTree(const Dir: String; KeepData: Boolean);
var F: TFindRec; Name: String;
begin
  if FindFirst(Dir + '\*', F) then begin
    try
      repeat
        Name := F.Name;
        if (Name <> '.') and (Name <> '..') then begin
          if KeepData and ((Name = 'data') or (Name = '.env') or (Name = 'logs') or (Name = 'backups')) then continue;
          if (F.Attributes and FILE_ATTRIBUTE_DIRECTORY) <> 0 then DelTree(Dir + '\' + Name, True, True, True)
          else DeleteFile(Dir + '\' + Name);
        end;
      until not FindNext(F);
    finally
      FindClose(F);
    end;
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var RemoveData: Boolean;
begin
  if CurUninstallStep = usPostUninstall then begin
    if UninstallSilent then RemoveData := ExpandConstant('{param:REMOVEDATA|0}') = '1'
    else RemoveData := MsgBox(CustomMessage('RemoveData'), mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES;
    { the package wrote files Setup did not track: remove the application, keep the data unless asked }
    DeleteAppTree(ExpandConstant('{app}'), not RemoveData);
    if RemoveData then DelTree(ExpandConstant('{app}'), True, True, True);
  end;
end;
