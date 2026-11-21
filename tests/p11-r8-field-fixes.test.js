'use strict';
// P11 round 8 (UX/field) — static + pure checks.
//  F-29 — the inspection form keeps the version and the action ids it loaded, sends them, and on a 409
//         inspection_changed reloads the latest version and reapplies ONLY what the user changed (never queued).
//  F-30 — (a) Sync now also resends the entries parked as "server error — needs attention"; (b) a database outage
//         (503 database_unavailable) is "will retry", never "Session expired", with an EN/FR text.
//  F-31 — the site-awareness helpdesk rule quotes the policy minimum (no literal "5") and an insufficient cell says
//         so; the project simplified-view summary cards have French entries.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');

function grab(src, name) {
  const i = src.indexOf('function ' + name + '(');
  assert.ok(i >= 0, name + ' exists');
  let depth = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}' && --depth === 0) break; }
  return src.slice(i, j + 1);
}
function load(src, names, ctx) {
  const m = { exports: {} };
  vm.runInNewContext(names.map((n) => grab(src, n)).join('\n') + '\nmodule.exports = {' + names.join(',') + '};', Object.assign({ module: m }, ctx || {}));
  return m.exports;
}
const plain = (v) => JSON.parse(JSON.stringify(v));   // vm-realm values → this realm
const page = read('public/inspection.html');
const fieldApp = read('public/field/app.js');
const CONC = ['_photoSig', 'inspItemFp', 'inspActionFp', 'inspSigFp', 'inspFingerprint', 'inspKnownIds', 'reapplyLocalEdits'];

test('F-29: reload-and-reapply keeps the other editor\'s actions and reapplies only what this user changed', () => {
  const { inspFingerprint, reapplyLocalEdits } = load(page, CONC);
  const loaded = { meta: { f_obs: 'old obs', f_scope: 'scope' }, items: { 'net__0': { status: 'ok', notes: '' }, 'net__1': { status: 'minor', notes: 'n' } },
    actions: [{ id: 1, desc: 'A1', owner: 'Alice', status: 'Open', base_status: 'Open' }], status: 'draft', server_version: 'v1' };
  const local = JSON.parse(JSON.stringify(loaded));
  local.base_fp = inspFingerprint(loaded);
  local.meta.f_obs = 'my new obs';                       // changed here
  local.items['net__1'].notes = 'my note';               // changed here
  local.actions.push({ desc: 'Mine', owner: 'Me', status: 'Open' });   // new here
  // meanwhile the server copy got a new action (with id), a changed scope and a changed finding the user did not touch
  const server = JSON.parse(JSON.stringify(loaded));
  server.server_version = 'v2'; server.known_action_ids = [1, 2];
  server.meta.f_scope = 'their scope';
  server.items['net__0'] = { status: 'major', notes: 'theirs' };
  server.actions.push({ id: 2, desc: 'NEW by editor2', owner: 'Bob', status: 'Open' });
  const { state, reapplied } = reapplyLocalEdits(local, server);
  assert.strictEqual(state.server_version, 'v2', 'the next save is based on the latest version');
  assert.deepStrictEqual(plain(state.known_action_ids), [1, 2]);
  assert.strictEqual(state.meta.f_obs, 'my new obs');
  assert.strictEqual(state.meta.f_scope, 'their scope', 'a field the user did not touch keeps the other editor\'s value');
  assert.deepStrictEqual(plain(state.items['net__0']), { status: 'major', notes: 'theirs' });
  assert.strictEqual(state.items['net__1'].notes, 'my note');
  assert.deepStrictEqual(plain(state.actions.map((a) => a.desc)), ['A1', 'NEW by editor2', 'Mine'], 'nothing of the other editor is dropped');
  assert.ok(reapplied >= 3);
});

test('F-29: the form sends server_version + known_action_ids, refreshes them after a save, and never queues a 409', () => {
  const { inspKnownIds } = load(page, CONC);
  assert.deepStrictEqual(plain(inspKnownIds({ actions: [{ id: 4 }, { desc: 'new' }], removed_action_ids: [9] }).sort()), [4, 9], 'an older copy knows the ids it holds + removed');
  assert.deepStrictEqual(plain(inspKnownIds({ known_action_ids: [1, 2], actions: [{ id: 1 }] })), [1, 2]);
  const fsn = grab(page, 'forceSyncNow');
  assert.match(fsn, /state\.known_action_ids = inspKnownIds\(state\)/);
  assert.match(fsn, /applySaveOutcome\(state, out/);   // P11 r9 F-32 — shared with the queue drain
  assert.match(grab(page, 'applySaveOutcome'), /st\.server_version = out\.version/);
  assert.match(fsn, /e\.status === 409 && e\.reason === 'inspection_changed'[\s\S]{0,240}dequeue\(id\)/);
  assert.match(fsn, /handleInspectionConflict\(id\)/);
  assert.match(grab(page, 'flushQueueOnce'), /inspection_changed/, 'the offline queue does not retry a refused save forever');
  assert.match(grab(page, 'fetchInspectionFromServer'), /base_fp = inspFingerprint/);
  const hic = grab(page, 'handleInspectionConflict');
  assert.match(hic, /__conflict_backup/, 'the local copy is kept before anything is replaced');
  assert.match(hic, /confirm\(/, 'the user chooses; nothing is overwritten silently');
  assert.ok(!/forceSyncNow\(/.test(hic), 'nothing is re-sent automatically after the reapply');
  // French for every new runtime text
  const ctx = { window: {} };
  vm.runInNewContext(read('public/lib/i18n/inspection.fr.js'), ctx);
  const dict = ctx.window.I18N_FR_INSPECTION;
  for (const m of hic.matchAll(/uiT\('([^']+)'\)/g)) assert.ok(m[1] in dict, 'French for ' + m[1]);
  for (const m of fsn.matchAll(/uiT\('([^']+)'\)/g)) assert.ok(m[1] in dict, 'French for ' + m[1]);
});

test('F-30 (a): Sync now re-arms the entries parked after the retry cap; per-entry Try again / Discard stay', () => {
  const { rearmEntry } = load(fieldApp, ['rearmEntry'], { stateOf: (e) => e.state || 'pending' });
  const e = { state: 'server_error', attempts: 8, next_try_at: null };
  assert.strictEqual(rearmEntry(e), true);
  assert.deepStrictEqual([e.state, e.attempts, e.next_try_at], ['failed', 0, null]);
  const r = { state: 'rejected', attempts: 1 };
  assert.strictEqual(rearmEntry(r), false, 'a refusal is never resent automatically');
  assert.strictEqual(r.state, 'rejected');
  assert.match(grab(fieldApp, 'flush'), /if \(rearm\) items\.forEach\(function \(e\) \{ rearmEntry\(e\); \}\)/);
  assert.match(fieldApp, /\$\('sync'\)\.addEventListener\('click'[^\n]*flush\(\{ force: true, rearm: true \}\)/, 'the Sync now button re-arms');
  assert.ok(!/addEventListener\('online'[^\n]*rearm/.test(fieldApp), 'coming back online does not re-arm (explicit action only)');
  assert.match(fieldApp, /data-ob-retry/); assert.match(fieldApp, /data-ob-drop/);
});

test('F-30 (b): database_unavailable keeps the server pace, stops the round and says "still signed in" (EN/FR)', () => {
  const { retryPlan } = load(fieldApp, ['retryPlan']);
  for (let k = 0; k < 20; k++) assert.deepStrictEqual(plain(retryPlan(2, 503, 'database_unavailable', '5')), { delaySec: 5, attempts: 2, giveUp: false });
  const ctx = { window: {}, document: { getElementById: () => null }, localStorage: { getItem: () => null, setItem: () => {} } };
  let dict = null; ctx.window.I18nText = { install: (o) => { dict = o.dict; }, t: (s) => s };
  vm.runInNewContext(read('public/field/i18n.js'), ctx);
  const { serverErrorText } = load(fieldApp, ['serverErrorText'], { FT: (s) => s });
  const t = serverErrorText(503, 'database_unavailable', null);
  assert.match(t, /still signed in/); assert.ok(!/Session expired/.test(t));
  assert.ok(t in dict, 'French for the database-unavailable text');
  assert.match(fieldApp, /j\.error === 'database_unavailable'/, 'the round stops (the others would get the same answer)');
  for (const m of fieldApp.matchAll(/FT\('([^']+)'\)/g)) assert.ok(m[1] in dict, 'no French for ' + m[1]);
  // server: the session checks map connection errors to 503, never 401
  const he = require('../services/httpError');
  for (const code of ['ECONNREFUSED', '57P01', '08006', '53300']) assert.strictEqual(he.asUnavailable(Object.assign(new Error('x'), { code })).code, 'DB_UNAVAILABLE');
  assert.strictEqual(he.asUnavailable(Object.assign(new Error('x'), { code: 'DB_BUSY' })).code, 'DB_BUSY');
  assert.strictEqual(he.asUnavailable(new Error('bad token')), null, 'any other error stays the caller\'s decision (fail closed)');
  assert.deepStrictEqual(he.UNAVAILABLE_CODES.DB_UNAVAILABLE, { status: 503, error: 'database_unavailable', retryAfter: 5 });
  const server = read('server.js'), guard = read('services/businessGuard.js');
  assert.ok(!/e\.code === 'DB_BUSY'\) return fail\(res, e\)/.test(server), 'every session check goes through asUnavailable');
  assert.strictEqual((server.match(/asUnavailable\(e\)/g) || []).length, 2);
  assert.match(guard, /asUnavailable\(e\)/);
});

test('F-31: the helpdesk rule quotes the policy minimum, and an insufficient cell says so (EN/FR)', () => {
  const sa = read('public/site-awareness.html');
  const tip = sa.match(/g_hd_tip:\s*\{ fr: '([^']+)', en: '((?:[^'\\]|\\.)+)' \}/);
  assert.ok(tip, 'the helpdesk tip exists');
  for (const s of [tip[1], tip[2]]) { assert.match(s, /\{min\}/); assert.ok(!/\b5\b/.test(s), 'no hard-coded minimum'); }
  assert.match(sa, /hdNote\.textContent = T\('g_hd_note_lbl'\) \+ ' ' \+ hdTip\(\)/);
  assert.match(sa, /title="\$\{esc\(hdTip\(\)\)\}"/);
  assert.match(grab(sa, 'hdTip'), /helpdesk_min_closed/);
  assert.match(sa, /c\.insufficient \?/);
  assert.match(sa, /g_hd_insufficient: \{ fr: '[^']+', en: '[^']+' \}/);
  assert.match(read('routes/siteAwareness.js'), /helpdesk_min_closed: [^\n]*hdPolicy\.min_closed/);
  assert.strictEqual(require('../public/lib/kpiRag').POLICIES['helpdesk-fleet-sla'].min_closed, 5, 'today\'s PROPOSED value (KPI committee)');
});

test('F-31: the project simplified-view summary cards have French entries', () => {
  const src = read('public/lib/ppmGovernanceW3.js');
  const ctx = { window: {} };
  vm.runInNewContext(read('public/lib/i18n/project.fr.js'), ctx);
  const d = ctx.window.I18N_FR_PROJECT;
  const fn = grab(src, 'loadSummary');
  const labels = [...fn.matchAll(/\['([^']+)', /g)].map((m) => m[1]).filter((l) => l !== 'RAG');
  assert.ok(labels.length >= 5);
  for (const l of labels) assert.ok(l in d, 'French for card ' + l);
  for (const l of ['Phases', 'Top risks and issues', 'Next milestones', 'No open risk or issue.', 'No upcoming milestone.', 'amounts restricted', 'earned value off']) assert.ok(l in d, 'French for ' + l);
});
