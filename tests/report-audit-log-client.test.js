'use strict';
// RBAC audit 2026-10-02, lot 3 (A11) — reports.html loadAuditLog.
// GET /api/reports/:id/audit is reserved to audit-viewer / admin. For any other account
// the page parsed the 403 error body, found no array, and printed "No audit entries yet"
// — a refusal read as an empty, clean history. It now says the history is restricted.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { fnSource } = require('./_fn-source');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'reports.html'), 'utf8');

async function render(status, body) {
  const tbody = { innerHTML: '' };
  const env = {
    currentReport: { id: 42 }, token: 't', window: { __ak: '' },
    document: { getElementById: () => tbody },
    fetch: async () => ({ status, ok: status === 200, json: async () => body }),
    esc: (s) => String(s), fmtDateTime: (s) => String(s), console: { warn() {}, error() {} },
  };
  const names = Object.keys(env);
  const fn = new Function(...names, fnSource(SRC, 'loadAuditLog') + '\nreturn loadAuditLog;')(...names.map(n => env[n]));
  await fn();
  return tbody.innerHTML;
}

test('A11 a refused audit log (403) is not shown as an empty history', async () => {
  const html = await render(403, { error: 'Forbidden — required role(s): audit-viewer or admin' });
  assert.doesNotMatch(html, /No audit entries yet/);
  assert.match(html, /restricted|réservé|not allowed|audit-viewer/i);
});

test('A11 a genuinely empty history still reads "No audit entries yet"', async () => {
  const html = await render(200, []);
  assert.match(html, /No audit entries yet/);
});
