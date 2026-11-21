'use strict';
// 2026-10-16 — the help documents tracker closed months, transfer statuses, the Site Actions hub, the report actions
// import / merge / group code and multi-site editors, in both languages. Drift guard, not prose review.
// 2026-11-21: anchors moved from numbered sections (10-6, 12-8, 12-9, 4-4) to stable module anchors.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs'), path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'help.html'), 'utf8').replace(/\r\n/g, '\n');
const block = (id) => { const a = src.indexOf(`id="${id}"`); assert.ok(a > 0, id); const n = src.slice(a + 5).search(/<div class="hsub"|<section/); return src.slice(a, n < 0 ? src.length : a + 5 + n); };
const lang = (html, l) => (html.match(new RegExp(`data-lng="${l}"[\\s\\S]*?(?=data-lng="|$)`, 'g')) || []).join(' ');

test('the sub-sections exist and are reachable from the table of contents or their chapter', () => {
  for (const id of ['tracker-closed-months', 'meetings-transfer', 'site-actions', 'reports-actions']) {
    assert.ok(src.includes(`id="${id}"`), id);
    assert.ok(src.includes(`href="#${id}"`) || ['tracker-closed-months', 'reports-actions'].includes(id), `${id} linked`);
  }
});

for (const l of ['en', 'fr']) {
  test(`[${l}] the key facts are stated`, () => {
    const s = lang(block('tracker-closed-months'), l);
    assert.match(s, /super_admin/);
    assert.match(s, /\b5(th)?\b/, "the grace day");
    const t = lang(block('meetings-transfer'), l);
    assert.match(t, /Demand \/ Initiative/);
    assert.match(t, /Helpdesk ticket/);
    assert.match(t, /SDP/);
    const a = lang(block('reports-actions'), l);
    assert.match(a, /#CODE/);
    assert.match(a, /Fusionner des doublons/);
  });
}

test('multi-site editors are documented in both languages', () => {
  assert.match(src, /Extra sites/);
  assert.match(src, /Sites supplémentaires/);
});
