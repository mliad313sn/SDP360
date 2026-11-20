'use strict';
// P11 round 6 (UX/field) — F-21: the Helpdesk site filter matched an upper-case SUBSTRING of the selected value, so
// 'MANA' also took 'MANAGEMENT' and 'ITY' took 'CITY OFFICE'; the "several spellings" note was only a tooltip.
// The filter now folds through the shared site aliases and compares whole words, and the note is visible text.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const HSD = require('../public/lib/helpdeskSiteDefault');
const SA = require('../public/lib/siteAliases');
const m = (row, sel) => HSD.siteMatches(row, sel, SA.siteFoldKey);

test('whole words and alias fold, never a raw substring', () => {
  assert.equal(m('MANAGEMENT', 'MANA'), false);
  assert.equal(m('CITY OFFICE', 'ITY'), false);
  assert.equal(m('Mana', 'MANA'), true);
  assert.equal(m('OUAGADOUGOU', 'Ouaga'), true, 'alias fold');
  assert.equal(m('Hounde Mine', 'HGO'), true, 'alias fold');
  assert.equal(m('LAFIGUE - SML', 'Lafigue'), true);
  assert.equal(m('London HQ', 'London'), true, 'whole words for a site the alias table does not know');
  assert.equal(m('Londonderry', 'London'), false);
  assert.equal(m('anything', 'all'), true);
  assert.equal(m('Massawa', 'Sabodala'), false, 'Massawa stays its own site');
});

test('the default never picks a spelling that would pull in another site', () => {
  const r = HSD.pickResult(['all', 'MANA', 'MANAGEMENT'], ['Mana'], SA.siteFoldKey);
  assert.equal(r.option, 'MANA');
  assert.equal(m('MANAGEMENT', r.option), false);
  const r2 = HSD.pickResult(['all', 'ITY', 'CITY OFFICE'], ['Ity'], SA.siteFoldKey);
  assert.equal(r2.option, 'ITY');
  assert.equal(m('CITY OFFICE', r2.option), false);
});

test('the memoised matcher agrees with siteMatches', () => {
  const f = HSD.matcher('MANA', SA.siteFoldKey);
  assert.equal(f('MANAGEMENT'), false); assert.equal(f('MANAGEMENT'), false);
  assert.equal(f('Mana'), true);
  assert.equal(HSD.matcher('all', SA.siteFoldKey)('x'), true);
});

test('the page filters with the matcher, not a substring', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(!/\['Site'\]\|\|''\)\.toUpperCase\(\)\.includes\(FS/.test(html), 'no substring site filter left');
  assert.equal((html.match(/_siteOk\(r\['Site'\]\)/g) || []).length, 3);
});

test('the note is visible text in a polite live region, in EN and FR', () => {
  const made = [];
  const mk = (tag) => {
    const el = { tagName: tag.toUpperCase(), children: [], attrs: {}, style: {}, textContent: '',
      setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; },
      appendChild(c) { this.children.push(c); c.parentNode = this; }, removeChild(c) { this.children = this.children.filter((x) => x !== c); },
      insertAdjacentElement(_w, c) { made.push(c); c.parentNode = { removeChild() {} }; } };
    return el;
  };
  const doc = { createElement: mk, getElementById: (id) => made.find((x) => x.id === id) || null };
  const sel = mk('select'); sel.ownerDocument = doc;
  const note = HSD.showNote(sel, HSD.NOTE_PICKED, ['HGO', 'Hounde Mine']);
  assert.equal(note.attrs.role, 'status');
  assert.equal(note.attrs['aria-live'], 'polite');
  assert.equal(sel.attrs['aria-describedby'], 'fSiteNote');
  assert.equal(note.children[0].textContent, HSD.NOTE_PICKED);
  assert.match(note.children[1].textContent, /HGO, Hounde Mine/);
  const fr = fs.readFileSync(path.join(__dirname, '..', 'public', 'lib', 'i18n', 'index.fr.js'), 'utf8');
  for (const k of [HSD.NOTE_PICKED, HSD.NOTE_ALL]) assert.ok(fr.includes(`'${k}':`), 'FR text for: ' + k);
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'lib', 'helpdeskSiteDefault.js'), 'utf8');
  assert.ok(!/selectEl\.title\s*=/.test(src), 'no tooltip-only explanation');
});
