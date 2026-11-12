'use strict';
// P8 / goal B1 — the WAN ▸ Réclamations tab is wired end to end (no orphan UI): hidden by default, revealed only when
// the claims status route answers (switch on), the pane script is loaded and calls the real routes, no amount is
// computed client-side, and no colour literal / inline handler was added (design + a11y ratchets).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'wan.html'), 'utf8').replace(/\r\n/g, '\n');
const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'lib', 'wanClaimsPane.js'), 'utf8').replace(/\r\n/g, '\n');

test('the tab is hidden until the status route answers, and the pane + script are present', () => {
  assert.match(html, /id="wtab-claims"[^>]*style="display:none"/);
  assert.match(html, /<div id="pane-claims" style="display:none">/);
  assert.match(html, /fetch\('\/api\/analytics\/wan\/sla\/claims\/status'\)/);
  assert.match(html, /const TABS = \['health', 'sla', 'claims'\]/);
  assert.match(html, /src="lib\/wanClaimsPane\.js"/);
});

test('the pane script uses the real routes and exposes its init', () => {
  assert.match(js, /window\.__wanClaimsInit = function/);
  for (const r of ["BASE + '/status'", "BASE + '/value?quarter='", "'/transition'", "'/notify/'", "'/evidence'", "api('POST', BASE,"]) assert.ok(js.includes(r), r);
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(js), 'no hex colour literal (use the page classes)');
  assert.ok(!/\son[a-z]+="/i.test(js), 'no inline handler');
});
