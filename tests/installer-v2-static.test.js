'use strict';
// Installer v2.1 — the rules a Windows build cannot check by itself (UAT 2026-10-29, EA-02/04/05/09/10).
// The real proof is the Windows end-to-end job (.github/workflows/installer.yml); these checks keep the
// script honest between two Windows runs.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const iss = fs.readFileSync(path.join(ROOT, 'tools/installer-v2/SDP-Dashboard.iss'), 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
const section = (name) => { const m = new RegExp(`^\\[${name}\\]\\n([\\s\\S]*?)(?=^\\[[A-Za-z]+\\]$)`, 'm').exec(iss + '\n[End]'); return m ? m[1] : ''; };
const code = iss.slice(iss.indexOf('[Code]'));

test('post-install.js is the LAST [Files] entry and runs through AfterInstall (its failure rolls Setup back)', () => {
  const lines = section('Files').split('\n').filter((l) => /^Source:/.test(l.trim()));
  assert.match(lines[lines.length - 1], /post-install\.js".*AfterInstall: RunPostInstall/);
});

test('the payload is offline: runtime, dependencies, service, Manager and the package are all embedded', () => {
  const files = section('Files');
  for (const p of ['runtime\\node', 'node_modules', 'service', 'manager', '{#PackageZip}']) assert.ok(files.includes(p), p);
});

test('post-install exit code is checked and a failure raises (no fire-and-forget [Run] for system actions)', () => {
  assert.match(code, /Exec\(ExpandConstant\('\{app\}\\runtime\\node\\node\.exe'\), Args[\s\S]*?Rc\)/);
  assert.match(code, /if Rc <> 0 then begin[\s\S]*?RaiseException/);
  assert.ok(!/post-install/.test(section('Run')), '[Run] only opens the dashboard / the Manager');
});

test('no secret on a command line or in the script: passwords travel in the environment or a deleted option file', () => {
  assert.ok(!/--superpassword/i.test(code), 'no --superpassword argument');
  assert.match(code, /SaveStringToFile\(Opt, 'superpassword='/);
  assert.match(code, /finally\s+DeleteFile\(Opt\)/);
  assert.match(code, /SetEnvironmentVariable\('SDP_SETUP_PGSUPERPASS', ''\)/);
  assert.ok(!/--pg-super|--password/i.test(code), 'post-install receives no password argument');
});

test('silent installs enforce the unsigned check; the superuser password is optional (post-install finds credentials)', () => {
  const run = code.slice(code.indexOf('procedure RunPostInstall'));
  assert.match(run, /PackageSigned\}' <> '1'\) and not UnsignedPage\.Values\[0\] then RaiseException/);
  assert.doesNotMatch(code, /GetPgSuperPassword = ''\) then (RaiseException|begin\s+MsgBox)/, 'a blank superuser password must not block Setup');
  const pi = require('fs').readFileSync(require('path').join(__dirname, '..', 'tools', 'installer-v2', 'post-install.js'), 'utf8');
  assert.match(pi, /previousEnvFiles\(\)/, 'reuses the previous SDP database account');
  assert.match(pi, /fourMyPeoplePassword\(\)/, 'falls back to the 4MyPeople standard password');
});

test('uninstall keeps data, .env, logs and backups unless asked, and removes the service first', () => {
  assert.match(section('UninstallRun'), /post-install\.js.*--mode uninstall/);
  assert.match(code, /\(Name = 'data'\) or \(Name = '\.env'\) or \(Name = 'logs'\) or \(Name = 'backups'\)/);
  assert.match(code, /\{param:REMOVEDATA\|0\}/);
});

test('modern bilingual wizard running as administrator on 64-bit Windows 10 / Server 2016+', () => {
  const setup = section('Setup');
  assert.match(setup, /WizardStyle=modern/);
  assert.match(setup, /PrivilegesRequired=admin/);
  assert.match(setup, /ArchitecturesAllowed=x64compatible/);
  assert.match(section('Languages'), /french/i);
});

test('XML project files and XAML hold no "--" inside a comment (MSBuild refuses to load them)', () => {
  const dirs = ['tools/manager/SdpDashboardManager', 'tools/service/SdpDashboardService'];
  for (const d of dirs) for (const f of fs.readdirSync(path.join(ROOT, d)).filter((n) => /\.(csproj|xaml|manifest)$/.test(n))) {
    const s = fs.readFileSync(path.join(ROOT, d, f), 'utf8');
    for (const m of s.matchAll(/<!--([\s\S]*?)-->/g)) assert.ok(!m[1].includes('--') && !m[1].endsWith('-'), `${d}/${f}: ${m[1].slice(0, 60)}`);
  }
});

test('a fresh installation starts without Zoho credentials (they are set later in Admin ▸ Intégration API)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const m = /const REQUIRED_ENV = \[([^\]]*)\]/.exec(src);
  assert.ok(m, 'REQUIRED_ENV found');
  assert.ok(!/ZOHO/.test(m[1]), 'Zoho keys are not required at startup');
  const env = fs.readFileSync(path.join(ROOT, 'tools/installer-v2/post-install.js'), 'utf8');
  for (const k of m[1].match(/[A-Z_]+/g)) assert.ok(new RegExp(`\\b${k}:`).test(env), `post-install writes ${k}`);
});

test('blank server: Setup carries PostgreSQL 17 and the IIS prerequisites, all signature-checked at build', () => {
  const build = fs.readFileSync(path.join(ROOT, 'tools/installer-v2/build.ps1'), 'utf8');
  assert.match(build, /postgresql-\$PgVersion-windows-x64\.exe/);
  assert.match(build, /rewrite_amd64/); assert.match(build, /requestRouter_amd64/);
  assert.match(build, /Get-AuthenticodeSignature/);
  assert.match(section('Files'), /\{#PgExe\}/); assert.match(section('Files'), /prereq/);
  const iis = fs.readFileSync(path.join(ROOT, 'tools/installer-v2/iis-setup.ps1'), 'utf8');
  assert.match(iis, /Install-WindowsFeature Web-Server/); assert.match(iis, /Get-AuthenticodeSignature/);
});

test('update: PostgreSQL is upgraded to the minor version Setup carries only after a backup, never on a new install', () => {
  const fn = code.slice(code.indexOf('procedure InstallEmbeddedPg;'), code.indexOf('procedure RunPostInstall;'));
  assert.match(fn, /if IsNew or/);
  assert.ok(fn.indexOf("backup --dir") > 0 && fn.indexOf("backup --dir") < fn.indexOf("'--mode unattended --unattendedmodeui none'"), 'backup comes before the upgrade');
});

test('every services/* module post-install.js loads from the Setup bootstrap is copied there by build.ps1 (exit 7, CI run 41413871253)', () => {
  const post = fs.readFileSync(path.join(ROOT, 'tools/installer-v2/post-install.js'), 'utf8');
  const build = fs.readFileSync(path.join(ROOT, 'tools/installer-v2/build.ps1'), 'utf8');
  const step6 = build.slice(build.indexOf("Step '6 bootstrap'"), build.indexOf("Step '7"));
  const names = [...new Set([...post.matchAll(/'services',\s*'([A-Za-z0-9_]+)'/g)].map((m) => m[1]))];
  assert.ok(names.length >= 3, 'expected at least apiKey, configSecrets, serviceControl');
  for (const n of names) assert.ok(step6.includes(`'services/${n}.js'`), `build.ps1 step 6 does not copy services/${n}.js`);
});

test('A-04: every path.join(ROOT, services|tools, …) file post-install.js uses is copied into the bootstrap by build.ps1', () => {
  const post = fs.readFileSync(path.join(ROOT, 'tools/installer-v2/post-install.js'), 'utf8');
  const build = fs.readFileSync(path.join(ROOT, 'tools/installer-v2/build.ps1'), 'utf8');
  const step6 = build.slice(build.indexOf("Step '6 bootstrap'"), build.indexOf("Step '7"));
  const refs = [...post.matchAll(/path\.join\(ROOT,\s*((?:'[^']+'\s*,?\s*)+)\)/g)].map((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));
  const files = refs.filter((r) => r[0] === 'services' || r[0] === 'tools').map((r) => { const f = r.join('/'); return /\.[a-z0-9]+$/i.test(f) ? f : f + '.js'; });
  assert.ok(files.length >= 3, 'found ' + files.join(', '));
  for (const f of files) assert.ok(step6.includes(`'${f}'`), `build.ps1 step 6 does not copy ${f}`);
});

test('A-04: the e2e UPDATE section asserts the pre-update backup is encrypted (.sql.gz.enc)', () => {
  const e2e = fs.readFileSync(path.join(ROOT, 'tools/installer-v2/tests/e2e.ps1'), 'utf8').replace(/\r\n/g, '\n');
  const upd = e2e.slice(e2e.indexOf("Section 'UPDATE"), e2e.indexOf('# A-02'));
  assert.match(upd, /\.sql\.gz\.enc/);
});

// A-02 — a PostgreSQL cluster Setup did not install (4MyPeople's postgresql-x64-17 hosts fmp_v2) is never
// upgraded: only a cluster carrying the SDP-Dashboard registry marker, or an explicit /UPGRADEPG=1.
const pgFn = () => code.slice(code.indexOf('procedure InstallEmbeddedPg;'), code.indexOf('procedure RunPostInstall;'));

test('A-02: the upgrade branch checks the Setup marker or /UPGRADEPG=1 before running postgresql.exe', () => {
  const fn = pgFn();
  const gate = fn.indexOf('if not (PgInstalledBySetup or UpgradePgRequested) then');
  assert.ok(gate > 0, 'gate present in InstallEmbeddedPg');
  assert.ok(gate < fn.indexOf("'--mode unattended --unattendedmodeui none'"), 'gate comes before the unattended upgrade');
  assert.match(code, /function UpgradePgRequested: Boolean;[\s\S]*?Param\('UPGRADEPG', '0'\) = '1'/);
  assert.match(code, /function PgInstalledBySetup: Boolean;[\s\S]*?RegQueryStringValue\(HKLM64, 'SOFTWARE\\SDP-Dashboard', 'PgInstalledBySetup', V\) and \(V = '1'\)/);
});

test('A-02: the skip path logs "managed by another product" and exits before any backup', () => {
  const fn = pgFn();
  const gate = fn.indexOf('if not (PgInstalledBySetup or UpgradePgRequested) then');
  const skip = fn.slice(gate, fn.indexOf('end;', gate) + 4);
  assert.match(skip, /Log\('PostgreSQL ' \+ Have \+ ' is managed by another product \(no SDP-Dashboard marker\) — not upgraded\. Re-run Setup with \/UPGRADEPG=1 to upgrade it deliberately\.'\)/);
  assert.match(skip, /\bexit;/);
  assert.ok(!/sdp-manager|MarkPgInstalledBySetup/.test(skip), 'no backup and no marker on the skip path');
  assert.ok(gate < fn.indexOf('backup --dir'), 'the gate comes before the backup');
});

test('A-02: the marker is written after a successful fresh install and after an allowed upgrade', () => {
  const fn = pgFn();
  const fresh = fn.indexOf("'--mode unattended --unattendedmodeui none --servicename");
  const freshRaise = fn.indexOf("RaiseException('PostgreSQL 17 installation failed", fresh);
  assert.ok(fresh > 0 && freshRaise > fresh);
  assert.ok(fn.indexOf('MarkPgInstalledBySetup', freshRaise) > freshRaise, 'marker after the fresh install succeeded');
  const upRaise = fn.indexOf("RaiseException('PostgreSQL upgrade to {#PgVersion} failed");
  const mark1 = fn.indexOf('MarkPgInstalledBySetup');
  assert.ok(upRaise > 0 && mark1 > upRaise && mark1 < fresh, 'marker after the allowed upgrade succeeded');
  assert.match(code, /procedure MarkPgInstalledBySetup;[\s\S]*?RegWriteStringValue\(HKLM64, 'SOFTWARE\\SDP-Dashboard', 'PgInstalledBySetup', '1'\)[\s\S]*?RegWriteStringValue\(HKLM64, 'SOFTWARE\\SDP-Dashboard', 'PgInstalledVersion', '\{#PgVersion\}'\)/);
});

test('A-02: the marker is never deleted on uninstall, and the GUI memo announces a skipped upgrade', () => {
  const uninstall = code.slice(code.indexOf('procedure DeleteAppTree'));
  assert.ok(!/RegDelete/.test(uninstall), 'no RegDelete* in the uninstall procedures');
  assert.ok(!/RegDelete[A-Za-z]*\([^)]*SDP-Dashboard/.test(code), 'the marker key is never deleted');
  assert.ok(!/^\[Registry\]$/m.test(iss) || !/uninsdeletekey|uninsdeletevalue/.test(section('Registry')));
  const memo = code.slice(code.indexOf('function UpdateReadyMemo'), code.indexOf('{ ---------- install ---------- }'));
  assert.match(memo, /PgUpgradeWouldBeSkipped then Result := Result \+ 'PostgreSQL: not upgraded \(not installed by Setup\)'/);
});
