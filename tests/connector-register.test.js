'use strict';
// G-19 / G-30 — every outbound integration is registered, and none reaches an excluded system
// (committee review 2026-10-28, scope rule: no new direct integration with Pronto ERP, OT/HSE, ISP systems,
// Nutanix, enterprise backup platforms, Microsoft Defender or an external project/portfolio product).
//
// A server-side file "makes outbound calls" when it loads an HTTP client or SMTP client, calls fetch(), or goes
// through services/safeUrl.js. Each such file must be listed in docs/sdp360/completion/CONNECTOR-REGISTER.csv
// (column `files`) or in INTERNAL below with its reason. A new connector therefore fails here until it is
// registered with a status and an owner.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const REGISTER = path.join(ROOT, 'docs/sdp360/completion/CONNECTOR-REGISTER.csv');
const SCAN = ['', 'routes', 'services', 'services/sync', 'tools', 'tools/teams', 'tools/meridian', 'tools/meraki', 'tools/opmanager', 'tools/reports', 'tools/pg', 'tools/installer-v2'];
const INTERNAL = new Map([
  ['services/safeUrl.js', 'the shared outbound transport (host allow-list), not a connector'],
  ['services/sync/jobs.js', 'job declarations; `fetch` is the job callback name'],
  ['services/sync/syncRunner.js', 'job runner; calls job.fetch()'],
  ['tools/installer-v2/post-install.js', 'checks the installed app answers on localhost'],
  ['tools/sdp-manager.js', 'operator tool calling the app’s own endpoints'],
]);
const OUTBOUND = /require\(['"](axios|https?|node-fetch|undici|nodemailer)['"]\)|(^|[^.\w])fetch\(|https?\.(request|get)\(|\bsafe(Get|Post)\(/m;
const EXCLUDED_HOST = /pronto|nutanix|veeam|commvault|veritas|rubrik|cohesity|securitycenter|security\.microsoft|api\.securitycenter|defender|atlassian|jira|asana|monday\.com|smartsheet|planview|clarity\.|projectonline|osisoft|aveva|intelex|enablon|cority/i;
const STATUSES = /^(ACTIVE|DORMANT|CONDITIONAL|OFF)/;

function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [h, ...body] = rows; return body.map((r) => Object.fromEntries(h.map((k, i) => [k, r[i] || ''])));
}
const register = parseCsv(fs.readFileSync(REGISTER, 'utf8'));
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');

function outboundFiles() {
  const out = [];
  for (const d of SCAN) {
    const abs = path.join(ROOT, d);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs)) {
      if (!f.endsWith('.js')) continue;
      const rel = path.posix.join(d.replace(/\\/g, '/'), f).replace(/^\//, '');
      if (OUTBOUND.test(strip(fs.readFileSync(path.join(abs, f), 'utf8')))) out.push(rel);
    }
  }
  return out;
}

test('every file that makes outbound calls is in the connector register (or is internal plumbing)', () => {
  const listed = new Set(register.flatMap((r) => r.files.split(';').map((x) => x.trim()).filter(Boolean)));
  const missing = outboundFiles().filter((f) => !listed.has(f) && !INTERNAL.has(f));
  assert.deepEqual(missing, [], 'unregistered outbound callers — add them to CONNECTOR-REGISTER.csv: ' + missing.join(', '));
});

test('register rows name real files and carry a status, a direction and an owner', () => {
  for (const r of register) {
    assert.match(r.status, STATUSES, `${r.id} status`);
    assert.ok(r.direction && r.owner_role, `${r.id} direction + owner`);
    for (const f of r.files.split(';').map((x) => x.trim()).filter(Boolean)) assert.ok(fs.existsSync(path.join(ROOT, f)), `${r.id}: ${f} exists`);
  }
});

test('no outbound caller and no default allowed host points at an excluded system', () => {
  const hits = [];
  for (const f of outboundFiles()) {
    const code = strip(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    for (const m of code.matchAll(/['"`]https?:\/\/([^/'"`\s:]+)/g)) if (EXCLUDED_HOST.test(m[1])) hits.push(`${f}: ${m[1]}`);
  }
  for (const h of require('../services/safeUrl').DEFAULT_ALLOW_HOSTS) if (EXCLUDED_HOST.test(h)) hits.push(`safeUrl default allow-list: ${h}`);
  assert.deepEqual(hits, []);
});

test('the excluded-system pattern does catch the systems it names (self-check)', () => {
  for (const h of ['api.securitycenter.microsoft.com', 'erp.pronto.example', 'prism.nutanix.local', 'veeam-api.corp', 'acme.atlassian.net', 'app.smartsheet.com']) assert.ok(EXCLUDED_HOST.test(h), h);
  for (const h of ['api.meraki.com', 'analyticsplusapi.manageengine.com', 'graph.microsoft.com', 'x.webhook.office.com']) assert.ok(!EXCLUDED_HOST.test(h), h);
});

test('D-06: the Meraki connector stays registered as ACTIVE', () => {
  const m = register.find((r) => /meraki/i.test(r.connector));
  assert.ok(m, 'Meraki row present');
  assert.match(m.status, /^ACTIVE/);
  assert.match(m.decision, /D-06/);
});

// G05 — every scheduled job that talks to the outside is owned by a register row, and every job a row
// names really exists in services/sync/jobs.js (no orphan connector, no phantom job).
test('scheduled jobs map to connectors and connectors name real jobs', () => {
  const INTERNAL_JOBS = new Set(['audit.chain_verify', 'audit.retention', 'commitments.escalate', 'db.backup', 'db.restore_drill', 'field.purge', 'handoffs.escalate']);
  const src = fs.readFileSync(path.join(ROOT, 'services', 'sync', 'jobs.js'), 'utf8');
  const declared = new Set([...src.matchAll(/legacyJob\('([a-z0-9_.]+)'/g), ...src.matchAll(/\bname:\s*'([a-z0-9_.]+)'/g)].map((m) => m[1]));
  const named = new Set(register.flatMap((r) => String(r.jobs || '').split(';').map((x) => x.trim()).filter((x) => x && x !== '-')));
  for (const j of named) assert.ok(declared.has(j), `register names job ${j}, which jobs.js does not declare`);
  for (const j of declared) assert.ok(named.has(j) || INTERNAL_JOBS.has(j), `job ${j} has no connector row and is not listed as internal`);
});
