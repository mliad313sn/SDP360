'use strict';
// SDP-DASH-2.0 step 5, lot 5.5 — CLAUDE.md is an INDEX. It is read into every session, so it must stay short
// (details go to docs/sop, docs/modules, docs/adr, docs/history, CHANGELOG.md) and every document it points
// to must exist, otherwise the index sends the reader nowhere.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MAX_LINES = 400;   // 2026-10-22: 6,220 → 266 lines
const src = fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8').replace(/\r\n/g, '\n');

test('CLAUDE.md stays an index (no regrowth)', () => {
  const lines = src.split('\n').length;
  assert.ok(lines <= MAX_LINES,
    `CLAUDE.md has ${lines} lines (max ${MAX_LINES}) — put the detail in docs/sop, docs/modules, docs/adr or CHANGELOG.md`);
});

test('every document the index points to exists', () => {
  const refs = new Set();
  for (const m of src.matchAll(/`((?:docs\/[\w./-]+)|CHANGELOG\.md)`/g)) refs.add(m[1]);
  assert.ok(refs.size >= 15, `expected the index to reference the docs, found ${refs.size}`);
  for (const ref of refs) {
    if (ref.includes('*')) {
      const dir = path.join(ROOT, path.dirname(ref));
      const prefix = path.basename(ref).split('*')[0];
      assert.ok(fs.existsSync(dir) && fs.readdirSync(dir).some(f => f.startsWith(prefix)), `${ref}: no match`);
    } else {
      assert.ok(fs.existsSync(path.join(ROOT, ref)), `${ref} is referenced by CLAUDE.md but does not exist`);
    }
  }
});

test('nothing was lost: the moved sections live in their documents', () => {
  for (const [file, heading] of [
    ['docs/sop/SOP-known-pitfalls.md', '## Known Pitfalls'],
    ['docs/sop/SOP-deploy.md', '## Deployment Steps'],
    ['docs/sop/SOP-browser-caching.md', '## Coding Principles — Browser-side asset caching'],
    ['docs/sop/SOP-pptx.md', '## PPTX Canvas'],
    ['docs/sop/SOP-kpi-sla.md', '## Incident SLA Configuration'],
    ['docs/modules/activity-tracker.md', '## IT Activity Tracker Module'],
    ['docs/modules/inspection.md', '## IT Inspection Module'],
    ['docs/modules/meetings.md', '## Meetings & Council Escalations Module'],
    ['docs/modules/risk-register.md', '## Risk Register Module'],
    ['docs/modules/exec-view.md', '## SharePoint Executive View'],
    ['docs/history/CURRENT-STATE-LOG.md', '## ⚡ Current state (as of 2026-10-16'],
  ]) {
    const doc = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.ok(doc.includes(heading), `${file} lost its section "${heading}"`);
  }
});
