'use strict';
// 2026-11-21 — the user manual is organised by profile and module, not by release history. Other pages link their
// "?" button to these STABLE anchors, so each must exist exactly once and carry both languages. The manual must not
// describe the removed SQLite store, must not use "Step N" chapter titles, and must state the real version.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs'), path = require('node:path');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'public', 'help.html'), 'utf8').replace(/\r\n/g, '\n');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const HP = require('../public/lib/help-page.js');

const REQUIRED = ['home', 'reports', 'site-actions', 'inspections', 'meetings', 'portfolio', 'project', 'admin',
  'policy-center', 'field', 'executive', 'tracker', 'helpdesk', 'kpi', 'security', 'faq', 'glossary'];

// The markup of the element carrying id="x": from its opening tag to its matching close (same tag name).
function elementOf(id) {
  const open = new RegExp(`<(section|div)\\b[^>]*\\sid="${id}"[^>]*>`).exec(src);
  if (!open) return null;
  const tag = open[1], re = new RegExp(`<${tag}\\b|</${tag}>`, 'g');
  re.lastIndex = open.index + open[0].length;
  let depth = 1, m;
  while ((m = re.exec(src))) { depth += m[0].startsWith('</') ? -1 : 1; if (!depth) return src.slice(open.index, m.index); }
  return null;
}
const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
function langText(html, lang) {
  const out = [];
  const re = new RegExp(`<(div|span)\\b[^>]*data-lng="${lang}"[^>]*>([\\s\\S]*?)</\\1>`, 'g');
  let m; while ((m = re.exec(html))) out.push(text(m[2]));
  return out.join(' ');
}

for (const id of REQUIRED) {
  test(`anchor #${id} exists exactly once, with an English and a French text`, () => {
    const n = (src.match(new RegExp(`\\sid="${id}"`, 'g')) || []).length;
    assert.strictEqual(n, 1, `#${id} occurs ${n} times`);
    const el = elementOf(id);
    assert.ok(el, `#${id} element`);
    assert.ok(langText(el, 'en').length > 40, `#${id} has English content`);
    assert.ok(langText(el, 'fr').length > 40, `#${id} has French content`);
    assert.ok(src.includes(`href="#${id}"`), `#${id} is reachable from the table of contents or a link`);
  });
}

test('no id is duplicated and every in-page link resolves', () => {
  const ids = [...src.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
  assert.deepStrictEqual(dup, []);
  const set = new Set(ids);
  const dangling = [...new Set([...src.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]))].filter((h) => !set.has(h));
  assert.deepStrictEqual(dangling, []);
});

test('no obsolete content: no SQLite, no "Step N" chapter titles, no release-history chapters', () => {
  assert.ok(!/sqlite/i.test(src), 'the platform is PostgreSQL-only');
  const headings = [...src.matchAll(/<h[1-4]\b[^>]*>([\s\S]*?)<\/h[1-4]>/g)].map((m) => text(m[1]));
  assert.deepStrictEqual(headings.filter((h) => /\b(step|étape)\s*\d+/i.test(h)), []);
  assert.deepStrictEqual(headings.filter((h) => /goal\s*0?\d|objectif 2027/i.test(h)), []);
});

test('the version and date on the cover match package.json and the manual date', () => {
  const v = /class="help-version">([^<]+)</.exec(src);
  assert.ok(v, 'version element');
  assert.strictEqual(v[1], pkg.version);
  assert.match(src, /<time datetime="2026-11-21">/);
});

test('no inline script and no inline handler (strict CSP ready); script and style are external', () => {
  const tags = [...src.matchAll(/<script\b([^>]*)>/g)].map((m) => m[1]);
  assert.ok(tags.every((t) => /\bsrc=/.test(t)), 'every script has a src');
  assert.ok(!/\son[a-z]+\s*=\s*"/i.test(src.replace(/<script\b[\s\S]*?<\/script>/g, '')), 'no inline handler');
  assert.ok(!/<style\b/.test(src), 'no inline style block');
  assert.match(src, /src="lib\/help-page\.js"/);
  assert.match(src, /href="lib\/help\.css"/);
  assert.match(src, /<main id="main"/);
  assert.match(src, /role="status"/);
});

test('help-page.js: former numbered anchors land on the new chapters, in their language', () => {
  assert.deepStrictEqual(HP.formerTarget('#en-25'), { lang: 'en', id: 'portfolio' });
  assert.deepStrictEqual(HP.formerTarget('#fr-12-8'), { lang: 'fr', id: 'meetings-transfer' });
  assert.deepStrictEqual(HP.formerTarget('#fr-18-3'), { lang: 'fr', id: 'assets-finance' });
  assert.deepStrictEqual(HP.formerTarget('#en-11-2'), { lang: 'en', id: 'inspections' }, 'unknown sub-section falls back to its chapter');
  assert.strictEqual(HP.formerTarget('#portfolio'), null);
  for (const id of Object.values(HP.FORMER)) assert.ok(src.includes(` id="${id}"`), `former map target #${id} exists`);
});

test('help-page.js: language follows sdp_lang, else the browser; search is accent- and case-insensitive', () => {
  assert.strictEqual(HP.pickLang('fr', 'en-GB'), 'fr');
  assert.strictEqual(HP.pickLang(null, 'fr-FR'), 'fr');
  assert.strictEqual(HP.pickLang('', 'en-US'), 'en');
  assert.ok(HP.matches('Synchronisation hors ligne', 'HORS ligne'));
  assert.ok(HP.matches('Réunions et PV', 'reunions pv'));
  assert.ok(!HP.matches('Inspections', 'portefeuille'));
  assert.ok(HP.matches('anything', '   '));
});
