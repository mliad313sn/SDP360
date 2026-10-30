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
