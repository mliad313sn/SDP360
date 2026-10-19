'use strict';
// 2026-10-16 — the help documents the latest changes in both languages: tracker closed months
// (10.6), transfer statuses (12.8), the Site Actions hub (12.9), the report actions import /
// merge / group code (4.4) and multi-site editors. Drift guard, not prose review.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs'), path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'help.html'), 'utf8').replace(/\r\n/g, '\n');
const NEW = ['7-5', '7-6', '7-7', '10-6', '12-8', '12-9'];

for (const lang of ['en', 'fr']) {
  const tocStart = [...src.matchAll(/<div class="toc">/g)].map(m => m.index)[lang === 'en' ? 0 : 1];
  const tocEnd = src.indexOf('\n    </div>', tocStart);

  test(`[${lang}] new sub-sections exist and are linked from INSIDE the table of contents`, () => {
    for (const id of NEW) {
      assert.ok(src.includes(`id="${lang}-${id}"`), `section ${lang}-${id}`);
      const link = src.indexOf(`href="#${lang}-${id}"`, tocStart);
      assert.ok(link > tocStart && link < tocEnd, `${lang}-${id} linked inside the TOC`);
    }
  });

  test(`[${lang}] the key facts are stated`, () => {
    const sec = (id) => src.slice(src.indexOf(`id="${lang}-${id}"`), src.indexOf('<h3', src.indexOf(`id="${lang}-${id}"`) + 5));
    assert.match(sec('10-6'), /super_admin/);
    assert.match(sec('10-6'), /\b5(th)?\b/, 'the grace day');
    const s128 = sec('12-8');
    assert.match(s128, /Demand \/ Initiative/);
    assert.match(s128, /Helpdesk ticket/);
    assert.match(s128, /SDP/);
    const s44 = sec('4-4');
    assert.match(s44, /#CODE/);
    assert.match(s44, /Fusionner des doublons/);
  });
}

test('EN table of contents of section 4 points each label at its own section', () => {
  assert.match(src, /href="#en-4-4">Action Items</);
  assert.match(src, /href="#en-4-5">Submitting a Report</);
});

test('multi-site editors are documented in both languages', () => {
  assert.match(src, /Extra sites/);
  assert.match(src, /Sites supplémentaires/);
});
