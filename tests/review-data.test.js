'use strict';
process.env.MEETINGS_BACKEND = 'sqlite';
process.env.INSPECTION_BACKEND = 'sqlite';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { loadReviewData } = require('../services/reviewData');

const SNAP = path.join(__dirname, '..', 'prod-snapshot');
const hasSnap = fs.existsSync(path.join(SNAP, 'meetings.db'));

test('returns the 7 EM_DATA arrays', { skip: !hasSnap && 'no prod-snapshot' }, async () => {
  const D = await loadReviewData('2026-07-14', _snapDeps());
  assert.deepStrictEqual(Object.keys(D).sort(),
    ['actions', 'findings', 'inspActions', 'inspections', 'issues', 'meetings', 'projects']);
});

// THE PROOF — the fixture is a LATER export of this same DB. Six arrays match
// exactly; inspActions drifted by one row (fixture id=84, created 2026-07-12;
// snapshot stops at id=83, 2026-07-07). Assert the six, and the drift explicitly
// — a bare 7-way count test fails against a CORRECT reader.
test('reproduces the fixture row counts (six arrays)', { skip: !hasSnap && 'no prod-snapshot' }, async () => {
  const EM = require('./fixtures/em-data.json');
  const D = await loadReviewData('2026-07-14', _snapDeps());
  for (const k of ['meetings', 'issues', 'actions', 'inspections', 'findings', 'projects']) {
    assert.strictEqual(D[k].length, EM[k].length, `${k}: ours ${D[k].length} vs fixture ${EM[k].length}`);
  }
});

test('inspActions: the fixture is one row ahead of the snapshot — known, documented drift', { skip: !hasSnap && 'no prod-snapshot' }, async () => {
  const EM = require('./fixtures/em-data.json');
  const D = await loadReviewData('2026-07-14', _snapDeps());
  const ourIds = new Set(D.inspActions.map(a => String(a.id)));
  const extra = EM.inspActions.filter(a => !ourIds.has(String(a.id))).map(a => a.id);
  assert.deepStrictEqual(extra, ['84'], 'only id=84 (created 2026-07-12) should be fixture-only');
  assert.strictEqual(D.inspActions.length, EM.inspActions.length - 1);
  // and it cannot affect the fidelity oracle: its status is Closed, and the sole
  // consumer (source :353) filters status !== 'Closed'.
  assert.strictEqual(EM.inspActions.find(a => String(a.id) === '84').status, 'Closed');
});

// THE REAL PROOF — the 5 denormalisation joins put the right value on the right row.
test('denormalised site_code/meeting_date match the fixture row-for-row', { skip: !hasSnap && 'no prod-snapshot' }, async () => {
  const EM = require('./fixtures/em-data.json');
  const D = await loadReviewData('2026-07-14', _snapDeps());
  const byId = (arr) => Object.fromEntries(arr.map(r => [String(r.id), r]));
  for (const [k, fields] of [
    ['issues',   ['site_code', 'meeting_date', 'department', 'status', 'severity', 'target_date', 'closed_at', 'champion', 'title']],
    ['actions',  ['site_code', 'meeting_date', 'status', 'target_date', 'closed_at']],
    ['projects', ['site_code', 'phase', 'target_end']],
    ['inspActions', ['site_code', 'status']],
  ]) {
    const ours = byId(D[k]);
    for (const t of EM[k]) {
      const o = ours[String(t.id)];
      // The ONE documented drift: inspActions id=84 is fixture-only (created
      // 2026-07-12; the snapshot stops at id=83 / 2026-07-07). Assert over the
      // 18 SHARED ids — a correct reader cannot conjure a row the snapshot
      // predates. The delta itself is pinned exactly by the test above, so
      // skipping it here narrows nothing: no other id is allowed to go missing.
      if (k === 'inspActions' && String(t.id) === '84') { assert.ok(!o); continue; }
      assert.ok(o, `${k} id=${t.id} missing from our reader`);
      for (const f of fields) {
        assert.strictEqual(String(o[f] ?? ''), String(t[f] ?? ''), `${k} id=${t.id} field ${f}`);
      }
    }
  }
});

// findings have no id in EM_DATA — compare the (site_code, inspection_date) multiset instead.
test('findings carry their parent inspection site/date', { skip: !hasSnap && 'no prod-snapshot' }, async () => {
  const EM = require('./fixtures/em-data.json');
  const D = await loadReviewData('2026-07-14', _snapDeps());
  const key = (f) => `${f.site_code}|${f.inspection_date}|${f.status}|${f.category}`;
  const tally = (arr) => arr.reduce((m, f) => (m[key(f)] = (m[key(f)] || 0) + 1, m), {});
  assert.deepStrictEqual(tally(D.findings), tally(EM.findings));
});

test('does NOT filter drafts — the boss export contains one and his model counts it', { skip: !hasSnap && 'no prod-snapshot' }, async () => {
  const D = await loadReviewData('2026-07-14', _snapDeps());
  assert.strictEqual(D.meetings.filter(m => m.status === 'draft').length, 1);
});

function _snapDeps() {
  // point the two db modules at prod-snapshot/ read-only
  const Database = require('better-sqlite3');
  const mdb = new Database(path.join(SNAP, 'meetings.db'), { readonly: true });
  const idb = new Database(path.join(SNAP, 'inspection.db'), { readonly: true });
  return { meetingsHandle: mdb, inspectionHandle: idb };
}
