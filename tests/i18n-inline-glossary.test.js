'use strict';
// E-U05 (audit U-10 prep) — the FR glossary's "À éviter" column checked against the inline French text of the
// pages (data-lng="fr" / data-lng-block="fr"). Lists every hit as file:line; fails on a NEW hit (the known
// ones wait for a francophone reviewer, gate 17) and on a variant that is not found anywhere in the code
// (the column only records what really exists). Also: one English label must not get two French renderings
// on the same page.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

function glossaryAvoid(md) {
  const out = [];
  for (const m of md.matchAll(/^\| ([^|]+?) \| ([^|]+?) \|([^|]*)\|([^|\n]*)\|/gm)) {
    const en = m[1].trim();
    if (en === 'English' || /^-+$/.test(en)) continue;
    const avoid = m[4].replace(/\([^)]*\)/g, '').split(',').map((s) => s.trim()).filter(Boolean);
    for (const v of avoid) out.push({ term: en, preferred: m[2].trim(), variant: v });
  }
  return out;
}
const strip = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
function frSpans(src) {
  const out = [];
  const re = /<([a-z0-9]+)\b[^>]*\bdata-lng(?:-block)?="fr"[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(src))) out.push({ line: src.slice(0, m.index).split('\n').length, text: strip(m[2]) });
  return out;
}
const variantRe = (v) => new RegExp('(?<![\\p{L}])' + v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\p{L}])', 'iu');
function scan(files, avoid) {
  const hits = [];
  for (const { file, src } of files) {
    for (const sp of frSpans(src)) {
      for (const a of avoid) if (variantRe(a.variant).test(sp.text)) hits.push(`${file}:${sp.line} ${a.term} → "${a.variant}"`);
    }
  }
  return hits.sort();
}
// Adjacent EN/FR pairs on one page: the same short English label translated two ways.
function pageDuplicates(src) {
  const re = /<([a-z0-9]+)\b[^>]*data-lng(?:-block)?="en"[^>]*>([\s\S]*?)<\/\1>\s*<([a-z0-9]+)\b[^>]*data-lng(?:-block)?="fr"[^>]*>([\s\S]*?)<\/\3>/gi;
  const by = new Map(); let m;
  while ((m = re.exec(src))) {
    const en = strip(m[2]); const fr = strip(m[4]);
    if (!en || en.split(' ').length > 5) continue;
    if (!by.has(en)) by.set(en, new Set());
    by.get(en).add(fr);
  }
  return [...by].filter(([, s]) => s.size > 1).map(([en, s]) => `${en} → ${[...s].join(' | ')}`);
}

const PAGES = () => fs.readdirSync(path.join(ROOT, 'public')).filter((f) => f.endsWith('.html')).sort()
  .map((f) => ({ file: 'public/' + f, src: read('public/' + f) }));
const AVOID = () => glossaryAvoid(read('docs/ux/GLOSSARY-FR.md'));

// Hits found on 2026-11-06 — left for the francophone review (gate 17). The list may only shrink.
const KNOWN_HITS = [
  'public/handoffs.html:46 Escalated → "remontée"',
  'public/meetings-insights.html:428 Closed → "Fermés"',
];

test('fixture: a variant inside a data-lng="fr" span is found with its line; English text and word fragments are not', () => {
  const avoid = [{ term: 'Closed', preferred: 'Clôturé', variant: 'Fermé' }];
  const src = '<p>\n<span data-lng="en">Closed</span><span data-lng="fr">Fermé</span>\n<span data-lng="fr">Fermer la fenêtre</span>\n<div data-lng-block="fr">Ticket <b>fermé</b> hier</div></p>';
  assert.deepEqual(scan([{ file: 'x.html', src }], avoid), ['x.html:2 Closed → "Fermé"', 'x.html:4 Closed → "Fermé"']);
});

test('fixture: one English label rendered two ways on one page is reported', () => {
  const src = '<span data-lng="en">Owner</span><span data-lng="fr">Responsable</span> <span data-lng="en">Owner</span><span data-lng="fr">Propriétaire</span>';
  assert.deepEqual(pageDuplicates(src), ['Owner → Responsable | Propriétaire']);
});

test('glossary: the "À éviter" column exists, stays PROPOSED, and every variant is really found in the code', () => {
  const md = read('docs/ux/GLOSSARY-FR.md');
  assert.match(md, /\| English \| Français \| Note \| À éviter \(PROPOSITION\) \|/);
  assert.match(md, /Statut : PROPOSÉ/);
  const avoid = AVOID();
  assert.ok(avoid.length >= 1);
  const texts = PAGES().flatMap((p) => frSpans(p.src).map((s) => s.text));
  const dir = path.join(ROOT, 'public/lib/i18n');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.fr.js'))) {
    const ctx = { window: {} };
    vm.runInNewContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx);
    for (const d of Object.values(ctx.window)) if (d && typeof d === 'object') texts.push(...Object.values(d).map(String));
  }
  for (const a of avoid) assert.ok(texts.some((t) => variantRe(a.variant).test(t)), `"${a.variant}" (${a.term}) is not found in the code — the column lists only real variants`);
});

test('tree: inline French text — hits are listed and no NEW variant appears (known ones wait for gate 17)', (t) => {
  const hits = scan(PAGES(), AVOID());
  t.diagnostic('inline glossary hits: ' + (hits.length ? hits.join(' ; ') : 'none'));
  assert.deepEqual(hits.filter((h) => !KNOWN_HITS.includes(h)), [], 'new avoided variant in inline French text');
  assert.deepEqual(KNOWN_HITS.filter((h) => !hits.includes(h)), [], 'a known hit was fixed — remove it from KNOWN_HITS');
});

test('tree: no page translates the same short English label two different ways', () => {
  const bad = [];
  for (const p of PAGES()) for (const d of pageDuplicates(p.src)) bad.push(p.file + ': ' + d);
  assert.deepEqual(bad, []);
});
