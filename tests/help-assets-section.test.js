'use strict';
// G-08 (audit 2026-09-24) — the Assets module must be documented, in both languages.
// 2026-11-21: the manual was reorganised by profile and module; the numbered anchors #en-18 / #fr-18 became the
// language-neutral #assets with one sub-section per tab. The guard is the same: section present, every tab
// covered in both languages, freshness rule stated, nothing blocked promised, entries inside the table of contents.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs'), path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'help.html'), 'utf8').replace(/\r\n/g, '\n');
// The seven tabs of public/assets.html, in page order.
const TABS = ['inventory', 'hygiene', 'finance', 'hardware', 'progress', 'investment', 'reconcile'];
const sec = src.slice(src.indexOf('id="assets"'), src.indexOf('<section', src.indexOf('id="assets"') + 10));

test('the Assets module has its own section, linked from the table of contents', () => {
  assert.ok(src.includes('<section class="hsec" id="assets">'));
  assert.ok(src.includes('href="#assets"'));
});

test('every Assets tab is documented in English and in French', () => {
  for (const t of TABS) {
    const at = sec.indexOf(`id="assets-${t}"`);
    assert.ok(at > 0, `sub-section assets-${t}`);
    const sub = sec.slice(at, sec.indexOf('<div class="hsub"', at + 5) > 0 ? sec.indexOf('<div class="hsub"', at + 5) : sec.length);
    assert.ok(sub.includes('data-lng="en"') && sub.includes('data-lng="fr"'), `assets-${t} in both languages`);
  }
});

test('the freshness rule is stated — the register is not live', () => {
  assert.match(sec, /04:30/);
  assert.ok(/jamais synchronis/i.test(sec) && /never synced/i.test(sec), 'the never-synced state is explained in both languages');
});

test('the help promises nothing that is blocked', () => {
  assert.ok(!/SDP import (template|format)/i.test(sec) || /not available/i.test(sec));
  assert.ok(!/format d'import SDP/i.test(sec) || /pas disponible/i.test(sec));
});

test('the Assets entry sits INSIDE the table-of-contents container', () => {
  const start = src.indexOf('<nav class="help-toc"');
  const end = src.indexOf('</nav>', start);
  const link = src.indexOf('href="#assets"');
  assert.ok(start > 0 && link > start && link < end, 'inside <nav class="help-toc">');
  assert.strictEqual((src.match(/<nav class="help-toc"/g) || []).length, 1, 'one table of contents');
});
