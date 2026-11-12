#!/usr/bin/env node
'use strict';
// Re-anchor the `file:line` (`anchor`) citations of docs/kpi/*.md after code moved (merges shift line numbers).
// For each citation whose line no longer contains its anchor, the line number is rewritten to the NEAREST line
// that does. A citation whose anchor is not found anywhere is left alone (tests/kpi-docs-links.test.js then fails).
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const CITE = /`([\w./-]+\.(?:js|mjs|html|sql)):(\d+)`( \(`([^`]+)`\))/g;
let moved = 0, lost = 0;
for (const f of ['COMMITTEE-CHARTER.md', 'PV-TEMPLATE.md', 'FORMULA-REFERENCE.md', 'DECISION-KPIS-PROPOSAL.md']) {
  const p = path.join(ROOT, 'docs', 'kpi', f);
  const text = fs.readFileSync(p, 'utf8');
  const out = text.replace(CITE, (all, file, line, tail, anchor) => {
    const src = path.join(ROOT, file);
    if (!fs.existsSync(src)) { lost++; return all; }
    const lines = fs.readFileSync(src, 'utf8').replace(/\r\n/g, '\n').split('\n');
    const n = Number(line);
    if (lines[n - 1] && lines[n - 1].includes(anchor)) return all;
    let best = null;
    lines.forEach((l, i) => { if (l.includes(anchor) && (best == null || Math.abs(i + 1 - n) < Math.abs(best - n))) best = i + 1; });
    if (best == null) { lost++; return all; }
    moved++;
    return '`' + file + ':' + best + '`' + tail;
  });
  if (out !== text) fs.writeFileSync(p, out);
}
console.log(`kpi-docs-reanchor: ${moved} citation(s) moved, ${lost} not found`);
