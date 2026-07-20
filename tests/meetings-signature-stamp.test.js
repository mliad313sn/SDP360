'use strict';

// Signature stamping must be SERVER-AUTHORITATIVE and IMMUTABLE.
//
// `signoff` is one of the 6 scored dimensions of the site programme score
// (services/siteScore.js) and it reads md_meetings.dept_head_signed_at /
// site_it_signed_at directly. A client that posts its own clock (or a
// tampered/skewed one) must NOT be able to dictate the stored timestamp,
// and a later re-save must never rewrite a signature that already landed
// (the UPDATE uses COALESCE — first write wins).

const { test, before } = require('node:test');
const assert = require('node:assert');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

process.env.SDP_DATA_DIR   = fs.mkdtempSync(path.join(os.tmpdir(), 'sdp-mtg-sig-'));
process.env.MEETINGS_BACKEND = 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 'smoke-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'smoke-pass-0000';

const mdb = require('../meetings-db');

const BOGUS_1 = '2020-01-01 00:00:00';
const BOGUS_2 = '1999-12-31 23:59:59';

// Parse the stored 'YYYY-MM-DD HH:MM:SS' form and assert it is "now"-ish.
function assertServerNow(stored, label) {
  assert.ok(stored, `${label}: expected a stored timestamp, got ${JSON.stringify(stored)}`);
  const t = Date.parse(String(stored).replace(' ', 'T') + 'Z');
  assert.ok(Number.isFinite(t), `${label}: stored value is not parseable: ${stored}`);
  const skew = Math.abs(Date.now() - t);
  assert.ok(skew < 5 * 60 * 1000,
    `${label}: stored timestamp is not server-generated (skew ${Math.round(skew / 1000)}s): ${stored}`);
}

// saveMeeting resolves an existing PV by its reference (SITE_Dept_PV_YYYY-MM),
// so every test needs its OWN department or it silently reuses (and COALESCEs
// against) the meeting a previous test stamped.
function header(dept, extra) {
  return {
    site_code:    'HGO',
    department:   dept,
    meeting_date: '2026-07-15',
    status:       'draft',
    ...extra,
  };
}

before(() => { mdb.loadLookups(); });

for (const field of ['dept_head_signed_at', 'site_it_signed_at']) {
  test(`${field}: a bogus client clock is REPLACED by the server timestamp`, () => {
    const r = mdb.saveMeeting({ header: header(`${field}-replace`, { [field]: BOGUS_1 }) }, null, 1);
    const rec = mdb.getMeeting(r.id);

    assert.notStrictEqual(rec.header[field], BOGUS_1,
      `${field}: the client-supplied clock was stored verbatim — the server must stamp it`);
    assertServerNow(rec.header[field], field);
  });

  test(`${field}: a re-save does NOT rewrite an existing signature`, async () => {
    const dept = `${field}-immutable`;
    const r = mdb.saveMeeting({ header: header(dept, { [field]: BOGUS_1 }) }, null, 1);
    const first = mdb.getMeeting(r.id).header[field];
    assertServerNow(first, field);

    // Let the clock move so a rewrite would be visible.
    await new Promise(res => setTimeout(res, 1100));

    mdb.saveMeeting({ id: r.id, header: header(dept, { [field]: BOGUS_2 }) }, null, 1);
    const second = mdb.getMeeting(r.id).header[field];

    assert.strictEqual(second, first,
      `${field}: an existing signature was overwritten — COALESCE first-write-wins is broken`);
  });

  test(`${field}: never stamped stays null`, () => {
    const r = mdb.saveMeeting({ header: header(`${field}-unstamped`, { [field]: null }) }, null, 1);
    const rec = mdb.getMeeting(r.id);
    assert.strictEqual(rec.header[field] || null, null,
      `${field}: an unstamped signature must stay null, got ${JSON.stringify(rec.header[field])}`);
  });
}
