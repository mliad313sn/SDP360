'use strict';
// Adoption Lot A (item 10) — every form control of the capture pages has an accessible name: a <label for>, a
// wrapping <label>, aria-label / aria-labelledby or title. The review counted 13 unlabelled controls on
// inspection.html, 12 on meeting.html, 8 on reports.html, 7 on meetings-issues.html and 5 on index.html (axe-style
// browser crawl). Static check of the authored markup; reports.html's admin console (super_admin panels) is outside
// this lot, like in the i18n coverage test.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8').replace(/\r\n/g, '\n');

function unlabelled(html) {
  const body = html.slice(html.indexOf('<body')).replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  const fors = new Set([...body.matchAll(/<label\b[^>]*\bfor="([^"]+)"/g)].map((m) => m[1]));
  const wrapped = new Set();
  for (const m of body.matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/g)) for (const c of m[1].matchAll(/<(?:input|select|textarea)\b[^>]*\bid="([^"]+)"/g)) wrapped.add(c[1]);
  const out = [];
  for (const m of body.matchAll(/<(input|select|textarea)\b([^>]*)>/g)) {
    const a = m[2];
    const type = (a.match(/\btype="([^"]+)"/) || [])[1] || '';
    if (['hidden', 'submit', 'button', 'reset', 'image'].includes(type)) continue;
    if (/\baria-label=|\baria-labelledby=|\btitle=/.test(a)) continue;
    const id = (a.match(/\bid="([^"]+)"/) || [])[1];
    if (id && (fors.has(id) || wrapped.has(id))) continue;
    out.push(`${m[1]}#${id || '?'}`);
  }
  return out;
}
function cut(html, start, end) { const a = html.indexOf(start), b = html.indexOf(end); assert.ok(a > 0 && b > a, 'markers'); return html.slice(0, a) + html.slice(b); }

for (const page of ['inspection.html', 'meeting.html', 'meetings-issues.html', 'index.html']) {
  test(`${page}: every form control has an accessible name`, () => {
    assert.deepStrictEqual(unlabelled(read(page)), []);
  });
}
test('reports.html (coordinator part, admin console excluded): every form control has an accessible name', () => {
  const html = cut(read('reports.html'), '<div class="page" id="page-admin">', '<div class="modal-overlay" id="change-week-modal"');
  assert.deepStrictEqual(unlabelled(html), []);
});
test('a <label for> never points at a control that another label wraps (no stolen association)', () => {
  for (const page of ['inspection.html', 'meeting.html', 'reports.html']) {
    const html = read(page);
    for (const m of html.matchAll(/<label\b[^>]*\bfor="([^"]+)"[^>]*>([\s\S]*?)<\/label>/g)) {
      assert.ok(!/<(input|select|textarea)\b/.test(m[2]), `${page}: label for="${m[1]}" wraps another control`);
      assert.ok(html.includes(`id="${m[1]}"`), `${page}: label for="${m[1]}" names an existing control`);
    }
  }
});
