'use strict';

// Unsigned-PV worklist: the `unsigned` filter on listMeetings + the
// signMeeting() helper. Both must respect the SERVER-AUTHORITATIVE +
// IMMUTABLE signature contract (see meetings-signature-stamp.test.js):
// `signoff` is a SCORED dimension, so the timestamp is the server's and
// the first stamp wins (COALESCE — never rewritten).

const { test, before } = require('node:test');
const assert = require('node:assert');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

process.env.SDP_DATA_DIR     = fs.mkdtempSync(path.join(os.tmpdir(), 'sdp-mtg-unsigned-'));
process.env.DASH_USER = process.env.DASH_USER || 'smoke-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'smoke-pass-0000';

const mdb = require('../meetings-db');

function header(site, dept, extra) {
  return { site_code: site, department: dept, meeting_date: '2026-07-15', status: 'draft', ...extra };
}
function assertServerNow(stored, label) {
  assert.ok(stored, `${label}: expected a stored timestamp, got ${JSON.stringify(stored)}`);
  const t = Date.parse(String(stored).replace(' ', 'T') + 'Z');
  assert.ok(Number.isFinite(t), `${label}: not parseable: ${stored}`);
  assert.ok(Math.abs(Date.now() - t) < 5 * 60 * 1000, `${label}: not server-generated: ${stored}`);
}

before(async () => { (await mdb.loadLookups()); });

// ── listMeetings({ unsigned }) ────────────────────────────────────────────
test('unsigned filter: a half-signed PV (dept yes, IT no) appears', async () => {
  const r = (await mdb.saveMeeting({ header: header('HGO', 'unsigned-half', { dept_head_signed_at: 'x' }) }, null, 1));
  const rows = (await mdb.listMeetings({ unsigned: 1, limit: 500 }));
  assert.ok(rows.some(m => m.id === r.id), 'half-signed PV must be in the unsigned worklist');
});

test('unsigned filter: a fully-signed PV does NOT appear', async () => {
  const r = (await mdb.saveMeeting({ header: header('HGO', 'unsigned-full', { dept_head_signed_at: 'x', site_it_signed_at: 'y' }) }, null, 1));
  const full = (await mdb.getMeeting(r.id)).header;
  assertServerNow(full.dept_head_signed_at, 'dept'); assertServerNow(full.site_it_signed_at, 'it');
  const rows = (await mdb.listMeetings({ unsigned: 1, limit: 500 }));
  assert.ok(!rows.some(m => m.id === r.id), 'fully-signed PV must NOT be in the unsigned worklist');
});

test('unsigned filter: an untouched PV appears (both null)', async () => {
  const r = (await mdb.saveMeeting({ header: header('HGO', 'unsigned-none') }, null, 1));
  const rows = (await mdb.listMeetings({ unsigned: 1, limit: 500 }));
  assert.ok(rows.some(m => m.id === r.id), 'never-signed PV must be in the unsigned worklist');
});

test('unsigned filter composes with site', async () => {
  const a = (await mdb.saveMeeting({ header: header('MGO', 'unsigned-site-mgo') }, null, 1));
  const b = (await mdb.saveMeeting({ header: header('SMI', 'unsigned-site-smi') }, null, 1));
  const rows = (await mdb.listMeetings({ unsigned: 1, site: 'MGO', limit: 500 }));
  assert.ok(rows.some(m => m.id === a.id), 'MGO unsigned PV present when scoped to MGO');
  assert.ok(!rows.some(m => m.id === b.id), 'SMI PV absent when scoped to MGO');
});

// ── signMeeting(id, which, { user }) ──────────────────────────────────────
test('signMeeting: signs dept_head only, IT stays null, server timestamp', async () => {
  const r = (await mdb.saveMeeting({ header: header('HGO', 'sign-dept-only') }, null, 1));
  const out = (await mdb.signMeeting(r.id, 'dept_head', { user: { id: 1 } }));
  assertServerNow(out.dept_head_signed_at, 'dept');
  assert.strictEqual(out.site_it_signed_at || null, null, 'IT signature must stay null');
  // Reflected in storage
  const rec = (await mdb.getMeeting(r.id)).header;
  assertServerNow(rec.dept_head_signed_at, 'dept-stored');
  assert.strictEqual(rec.site_it_signed_at || null, null, 'IT stored null');
});

test('signMeeting: signs site_it', async () => {
  const r = (await mdb.saveMeeting({ header: header('HGO', 'sign-it-only') }, null, 1));
  const out = (await mdb.signMeeting(r.id, 'site_it', { user: { id: 1 } }));
  assertServerNow(out.site_it_signed_at, 'it');
  assert.strictEqual(out.dept_head_signed_at || null, null, 'dept stays null');
});

test('signMeeting: re-signing does NOT overwrite (immutable, first stamp wins)', async () => {
  const r = (await mdb.saveMeeting({ header: header('HGO', 'sign-immutable') }, null, 1));
  const first = (await mdb.signMeeting(r.id, 'dept_head', { user: { id: 1 } })).dept_head_signed_at;
  assertServerNow(first, 'first');
  await new Promise(res => setTimeout(res, 1100));
  const second = (await mdb.signMeeting(r.id, 'dept_head', { user: { id: 1 } })).dept_head_signed_at;
  assert.strictEqual(second, first, 'an existing signature was overwritten — COALESCE broken');
});

test('signMeeting: an invalid `which` is rejected', async () => {
  const r = (await mdb.saveMeeting({ header: header('HGO', 'sign-bad-which') }, null, 1));
  await assert.rejects(async () => (await mdb.signMeeting(r.id, 'ceo', { user: { id: 1 } })), /which|invalid/i);
});
