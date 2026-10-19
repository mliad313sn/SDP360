'use strict';
// Step 4 — CSP without inline scripts on NEW pages. The inherited pages carry thousands of
// inline onclick= handlers (the removal plan is in docs/sdp360/design/ETAPE-04-securite.md);
// any page NOT in this legacy list must use addEventListener and a nonce'd <script>.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const PUB = path.join(__dirname, '..', 'public');
const LEGACY = new Set(['activity-tracker.html', 'analytics.html', 'assets-finance.html', 'assets-hygiene.html', 'assets.html', 'exec-view.html', 'executive-report.html', 'executive.html', 'help.html', 'index.html', 'infra-health.html', 'inspection-actions.html', 'inspection.html', 'inspections.html', 'it-review.html', 'itsm-roadmap.html', 'login.html', 'meeting.html', 'meetings-actions.html', 'meetings-compliance.html', 'meetings-council.html', 'meetings-import.html', 'meetings-insights.html', 'meetings-issues.html', 'meetings-progress.html', 'meetings.html', 'reports.html', 'site-actions.html', 'site-awareness.html', 'site-report.html', 'system-logs.html', 'wan-health.html', 'wan-sla.html', 'wan.html', 'meetings-setup.html', 'meetings-unsigned.html', 'itsm-integrations-plan.html']);
const INLINE = /\son(click|change|input|submit|load|keyup|keydown|blur|focus|mouseover)\s*=/i;

test('pages added after the fork carry no inline event handlers', () => {
  const bad = [];
  for (const f of fs.readdirSync(PUB).filter((n) => n.endsWith('.html'))) {
    if (LEGACY.has(f)) continue;
    const src = fs.readFileSync(path.join(PUB, f), 'utf8');
    const n = (src.match(new RegExp(INLINE.source, 'gi')) || []).length;
    if (n) bad.push(`${f}: ${n}`);
  }
  assert.deepEqual(bad, [], 'inline handlers on new pages:\n' + bad.join('\n'));
});

test('the legacy inventory is a snapshot, not a growing allowlist (every entry still exists or was removed on purpose)', () => {
  const present = new Set(fs.readdirSync(PUB).filter((n) => n.endsWith('.html')));
  const stale = [...LEGACY].filter((f) => !present.has(f));
  assert.ok(stale.length === 0, 'legacy list drifted: ' + stale.join(', '));
});
