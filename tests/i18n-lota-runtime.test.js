'use strict';
// P11 round 4 F-12 — the Adoption Lot A daily list pages (inspections, inspection actions, meetings, meeting actions,
// issues log) also translate the texts their scripts build: toasts, empty states, row buttons, table heads, prompts.
// The strings below are the ones the round-4 review found still English with ui_i18n_pages=1. Chart labels drawn on a
// canvas and the content of the exported PPTX deck are out of scope (not page text).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const PUB = path.join(__dirname, '..', 'public');

function dict(file, name) {
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(PUB, 'lib/i18n/common.fr.js'), 'utf8'), ctx);
  vm.runInNewContext(fs.readFileSync(path.join(PUB, 'lib/i18n', file), 'utf8'), ctx);
  return Object.assign({}, ctx.window.I18N_FR_COMMON, ctx.window[name]);
}
const EXPECT = {
  'inspections.html': ['inspections.fr.js', 'I18N_FR_INSPECTIONS', ['No data yet.', 'This cannot be undone.', 'No repeat finding.', 'Delete failed:', 'Export failed:', 'Excel export failed:', 'Open ▸']],
  'inspection-actions.html': ['inspection-actions.fr.js', 'I18N_FR_INSPECTION_ACTIONS', ['Verify', 'No actions match the current filter.', 'Excel downloaded', 'PPTX exported', 'Update failed:', 'Verification note (what you checked):', 'Failed to load actions.', 'Total actions']],
  'meetings.html': ['meetings.fr.js', 'I18N_FR_MEETINGS', ['Excel export failed:', 'No priorities recorded', 'Open ›', 'Failed to load meetings.']],
  'meetings-actions.html': ['meetings-actions.fr.js', 'I18N_FR_MEETINGS_ACTIONS', ['No actions match the current filter.', 'Excel downloaded', 'PV closed', 'Update failed:', 'No champion']],
  'meetings-issues.html': ['meetings-issues.fr.js', 'I18N_FR_MEETINGS_ISSUES', ['No issues match the current filter.', 'Editor role or higher required to change status', 'Issue updated →', 'Total issues']],
};
for (const [page, [file, name, keys]] of Object.entries(EXPECT)) {
  test(`${page}: the script-built texts have a French entry`, () => {
    const d = dict(file, name);
    for (const k of keys) assert.ok(typeof d[k] === 'string' && d[k] !== k, `${k} has no French text`);
  });
  test(`${page}: a toast / alert / prompt with a dynamic part goes through uiT() (no raw English prefix)`, () => {
    const src = fs.readFileSync(path.join(PUB, page), 'utf8');
    assert.match(src, /function uiT\(s\)/);
    assert.doesNotMatch(src, /(toast|alert)\('[A-Z][^']*: ' \+/, 'a prefix + value message is still built in English');
    assert.doesNotMatch(src, /window\.prompt\('/, 'a prompt is still English');
  });
}
