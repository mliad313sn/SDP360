'use strict';
// A second "Stamp signature" click during the first stamp's save used to start a concurrent
// full-PV save that could drop the first signature (W2-QJ journey c1). Both buttons are now
// disabled while one stamp save runs, and a re-entrant call is ignored.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'meeting.html'), 'utf8').replace(/\r\n/g, '\n');

test('stampSignature disables BOTH stamp buttons and ignores a re-entrant click', () => {
  const start = src.indexOf('async function stampSignature(');
  assert.ok(start > 0, 'stampSignature not found');
  const body = src.slice(start, src.indexOf('\n  }\n', start));
  assert.match(src, /const STAMP_BTNS = \['pvStampDeptHead', 'pvStampItLead'\]/);
  assert.match(body, /if \(_stampBusy\) return;/);
  assert.match(body, /STAMP_BTNS\.forEach\(id => \{[^}]*disabled = true/);
  assert.match(body, /finally \{[\s\S]*_stampBusy = false;[\s\S]*disabled = false/);
});
