#!/usr/bin/env node
'use strict';
// EX-01 — secret scanner for the TRACKED files (the working tree as git sees it). Fails (exit 1) on a
// credential-shaped value. It never prints a value: only the file, the line number and the rule.
//   node tools/security/secret-scan.js            scan the tracked files
//   node tools/security/secret-scan.js --history  also scan every past revision (git log -p), report only
// Placeholders (<...>, ***, ${...}, %VAR%, $env:X, process.env.X, example/dummy/changeme) never count.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const RULES = [
  { id: 'pg-url-password', re: /postgres(?:ql)?:\/\/[^\s:/@'"]+:([^\s@'"]+)@/g },
  { id: 'private-key', re: /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g, all: true },
  { id: 'zoho-refresh-token', re: /\b1000\.[0-9a-f]{32}\.[0-9a-f]{32}\b/g, all: true },
  { id: 'teams-webhook', re: /https:\/\/[a-z0-9.-]+\.(?:webhook\.office\.com|logic\.azure\.com)[^\s'"]*sig=([^\s&'"]+)/gi },
  { id: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/g, all: true },
  { id: 'assigned-password', re: /\b\w*(?:PASSWORD|PASSWD|PG_?PASS|SECRET|API_?KEY|CLIENT_SECRET|REFRESH_TOKEN)\b["']?\s*[:=]\s*["']([^"'\s]{8,})["']/gi },
];
// Throwaway values that exist ONLY for ephemeral CI / test clusters, named so a reviewer sees them.
const ALLOWED_VALUES = new Set(['postgres', 'root', 'ci-admin-pass-0000', 'ci-password-0000!']);
const PLACEHOLDER_PREFIX = /^(<[^>]+>|\*{3,}|\$\{|%[A-Z_]+%|\$env:|process\.env|\$[A-Za-z_])/;
const PLACEHOLDER_WORD = /^(x+|\.\.\.|dummy|example|changeme|placeholder|redacted|password|secret|test|xxx|pass|pwd)$/i;
// Test suites (Node, PowerShell, the QA harness) build throwaway connection strings on purpose.
const SKIP = [/^tests\//, /^tools\/installer\/tests\//, /^tools\/installer-v2\/tests\//, /^tools\/qa\//, /^docs\//, /\.md$/, /^vendor\//, /package-lock\.json$/, /\.min\.js$/, /^public\/brand\//, /\.(png|jpg|ico|bmp|pptx|xlsx|docx|zip|pdf|woff2?)$/i];

function suspicious(rule, m) {
  if (rule.all) return true;
  const v = m[1] || '';
  if (!v || PLACEHOLDER_PREFIX.test(v) || PLACEHOLDER_WORD.test(v) || ALLOWED_VALUES.has(v)) return false;
  if (/^[A-Z_]+$/.test(v) || /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(v)) return false;   // a variable / config-key name, not a value
  return true;
}
function scanText(file, text) {
  const hits = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const r of RULES) { r.re.lastIndex = 0; let m; while ((m = r.re.exec(line))) if (suspicious(r, m)) hits.push({ file, line: i + 1, rule: r.id }); }
  });
  return hits;
}
function trackedFiles() {
  return execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter((f) => f && !SKIP.some((re) => re.test(f)));
}
function scanTree() {
  const hits = [];
  for (const f of trackedFiles()) { let t; try { t = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (_) { continue; } if (t.includes('\u0000')) continue; hits.push(...scanText(f, t)); }
  return hits;
}
function scanHistory() {
  const out = execFileSync('git', ['log', '--all', '-p', '--no-color', '--unified=0', '--format=@@commit %H'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 });
  const hits = []; let commit = '', file = '';
  for (const line of out.split('\n')) {
    if (line.startsWith('@@commit ')) { commit = line.slice(9, 16); continue; }
    if (line.startsWith('+++ b/')) { file = line.slice(6); continue; }
    if (!line.startsWith('+') || line.startsWith('+++') || SKIP.some((re) => re.test(file))) continue;
    for (const h of scanText(file, line.slice(1))) hits.push({ commit, file: h.file, rule: h.rule });
  }
  const seen = new Set(); return hits.filter((h) => { const k = h.commit + h.file + h.rule; if (seen.has(k)) return false; seen.add(k); return true; });
}

if (require.main === module) {
  const hits = scanTree();
  for (const h of hits) console.log(`SECRET? ${h.file}:${h.line} (${h.rule})`);
  if (process.argv.includes('--history')) {
    const hh = scanHistory();
    console.log(`history: ${hh.length} credential-shaped addition(s) in past revisions (values not shown)`);
    for (const h of hh) console.log(`  ${h.commit} ${h.file} (${h.rule})`);
  }
  console.log(hits.length ? `${hits.length} finding(s) in the tracked files — release blocked` : 'secret scan: no credential in the tracked files');
  process.exit(hits.length ? 1 : 0);
}
module.exports = { scanText, scanTree, scanHistory, RULES };
