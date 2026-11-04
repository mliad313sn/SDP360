'use strict';
// A-19 — reader guard: every SQL statement that READS a soft-deletable table (FROM / JOIN <table>) in the listed
// files must filter `deleted_at` — or be on the allowlist below with the reason it may see deleted rows.
// A reader added later without the filter fails here instead of silently showing deleted records.
//
// The statement window = from the FROM/JOIN to the call that executes it (.get( / .all( / .run() or the end of the
// template constant. Where a WHERE is assembled by a builder (`${w}`), the builder itself is pinned by a unit test
// and the function is allowlisted with that reason.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');

// file → tables guarded in it
const GUARDED = {
  'inspection-db.js': ['insp_inspections'],
  'meetings-db.js': ['md_meetings'],
  'services/reviewData.js': ['insp_inspections', 'md_meetings'],
};

// file → function name → reason it may read deleted rows / gets its filter elsewhere
const ALLOW = {
  'inspection-db.js': {
    _deleteInspectionPg: 'the hard delete itself (switch off)',
    getInspectionTrashRow: 'restore / trash read: must see deleted rows',
    listDeletedInspections: 'admin trash listing: deleted rows only',
    purgeDeletedInspections: 'purge: deleted rows past retention only',
    _saveInspectionPg: 'reads deleted_at to REFUSE a resurrecting save (CONFLICT)',
    _getInspectionPg: "filter is conditional (includeDeleted for the admin view) — `deleted_at IS NULL` appended in the template",
    _aggregatePg: 'WHERE comes from `w`, always seeded with i.deleted_at IS NULL (pinned by soft-delete-inspection)',
    _listActionsPg: 'WHERE comes from `w`, always seeded with i.deleted_at IS NULL (pinned by soft-delete-inspection)',
    exportRows: 'WHERE comes from `w` / `wi`, always carrying deleted_at IS NULL',
  },
  'meetings-db.js': {
    _deleteMeetingPg: 'the hard delete itself (switch off)',
    getMeetingTrashRow: 'restore / trash read: must see deleted rows',
    listDeletedMeetings: 'admin trash listing: deleted rows only',
    purgeDeletedMeetings: 'purge: deleted rows past retention only',
    _saveMeetingPg: 'resolves by id / reference / month INCLUDING deleted PVs to REFUSE a resurrecting save (CONFLICT)',
    _lockMeetingShared: 'row lock only (FOR SHARE) for a child write whose parent was already resolved through a filtered reader',
    _editTokenPg: 'concurrency token of a PV already resolved through a filtered reader',
    _listMeetingsPg: 'WHERE comes from _meetingsWhere(), always seeded with m.deleted_at IS NULL',
    _countMeetingsPg: 'WHERE comes from _meetingsWhere(), always seeded with m.deleted_at IS NULL',
    _listIssuesPg: 'WHERE comes from `w`, always seeded with m.deleted_at IS NULL',
    _listActionsPg: 'WHERE comes from `w`, always seeded with m.deleted_at IS NULL',
    _aggregatePg: 'WHERE comes from `w`, always seeded with m.deleted_at IS NULL',
    exportRows: 'WHERE comes from `wm`, always carrying m.deleted_at IS NULL',
  },
};

function enclosingFn(src, pos) {
  const head = src.slice(0, pos);
  const re = /(?:^|\n)\s*(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/g;
  let m, name = null;
  while ((m = re.exec(head))) name = m[1];
  return name;
}

function windowAt(src, pos) {
  const rest = src.slice(pos);
  const ends = ['.get(', '.all(', '.run(', '`;', "';"].map((t) => rest.indexOf(t)).filter((i) => i >= 0);
  return rest.slice(0, Math.min(1500, ...ends));
}

function violations(file, tables, allow) {
  const src = read(file);
  const out = [];
  for (const t of tables) {
    const re = new RegExp(`\\b(?:FROM|JOIN)\\s+${t}\\b`, 'g');
    let m;
    while ((m = re.exec(src))) {
      // skip comments (line comments and the leading `*` of block comments)
      const lineStart = src.lastIndexOf('\n', m.index) + 1;
      const line = src.slice(lineStart, m.index);
      if (/^\s*(\/\/|\*)/.test(line) || /\/\//.test(line)) continue;
      if (/deleted_at/.test(windowAt(src, m.index))) continue;
      const fn = enclosingFn(src, m.index);
      if (fn && allow && allow[fn]) continue;
      out.push(`${file}:${src.slice(0, m.index).split('\n').length} (${fn || 'top level'}): ${src.slice(m.index, m.index + 80).replace(/\s+/g, ' ')}`);
    }
  }
  return out;
}

for (const [file, tables] of Object.entries(GUARDED)) {
  test(`every read of ${tables.join(', ')} in ${file} filters deleted_at or is allowlisted`, () => {
    const v = violations(file, tables, ALLOW[file]);
    assert.deepEqual(v, [], 'unfiltered readers:\n' + v.join('\n'));
  });
}

test('the guard bites: an unfiltered reader is reported', () => {
  const tmp = path.join(require('os').tmpdir(), `sd-guard-${process.pid}.js`);
  fs.writeFileSync(tmp, "async function bad(){ return H.prepare('SELECT * FROM insp_inspections WHERE id = ?').get(1); }\nasync function good(){ return H.prepare('SELECT * FROM insp_inspections WHERE deleted_at IS NULL').all(); }\n");
  const rel = path.relative(root, tmp);
  const v = violations(rel, ['insp_inspections'], {});
  fs.unlinkSync(tmp);
  assert.equal(v.length, 1);
  assert.match(v[0], /\(bad\)/);
});

test('allowlist entries are real functions (no stale entries)', () => {
  for (const [file, fns] of Object.entries(ALLOW)) {
    const src = read(file);
    for (const fn of Object.keys(fns)) assert.match(src, new RegExp(`function\\s+${fn}\\s*\\(`), `${file}: ${fn} no longer exists`);
  }
});

