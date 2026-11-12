'use strict';
// F-UX-10 — static accessibility floor for EVERY page (the 15 "new" pages are held at zero by
// tests/a11y-static.test.js; the legacy pages are pinned here and may only improve).
//   node tools/agent/a11y-legacy.js            print the per-page counts
//   node tools/agent/a11y-legacy.js --write    rewrite the baseline (tests/fixtures/a11y-legacy-baseline.json)
//                                              and docs/ux/A11Y-LEGACY.md — ONLY after a reviewed improvement
//   node tools/agent/a11y-legacy.js --check    exits 1 when the doc is out of date with the baseline
// Not an axe run and not a conformance statement: the same string checks as a11y-static, counted.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const PUB = path.join(ROOT, 'public');
const BASELINE = path.join(ROOT, 'tests', 'fixtures', 'a11y-legacy-baseline.json');
const DOC = path.join(ROOT, 'docs', 'ux', 'A11Y-LEGACY.md');
const RULES = ['lang', 'viewport', 'skip_link', 'main', 'unlabelled_control', 'img_no_alt', 'positive_tabindex', 'inline_handler', 'status_region'];

// A redirect stub (meta refresh to the moved page) has no content to check.
const isStub = (s) => /<meta http-equiv="refresh"/i.test(s) && s.length < 2000;

function check(s) {
  const c = {};
  c.lang = /<html lang="[a-z]{2}"/.test(s) ? 0 : 1;
  c.viewport = /<meta name="viewport"/.test(s) ? 0 : 1;
  // the shell injects the skip link (A-12a) on pages that load _shell.js
  c.skip_link = /class="edv-skip" href="#main"/.test(s) || /src="[^"]*_shell\.js/.test(s) ? 0 : 1;
  c.main = /<main\b/.test(s) ? 0 : 1;
  let unl = 0;
  for (const m of s.matchAll(/<(input|select|textarea)\b[^>]*>/g)) {
    const tag = m[0]; if (/type="hidden"/.test(tag)) continue;
    const id = /\bid="([^"]+)"/.exec(tag);
    const ok = /aria-label(ledby)?=/.test(tag) || /\btitle="[^"]+"/.test(tag) || (id && (s.includes(`for="${id[1]}"`) || new RegExp(`<label[^>]*>[^<]*<${m[1]}[^>]*id="${id[1].replace(/[^\w-]/g, '')}"`).test(s)));
    if (!ok) unl++;
  }
  c.unlabelled_control = unl;
  c.img_no_alt = [...s.matchAll(/<img\b[^>]*>/g)].filter((m) => !/\balt=/.test(m[0])).length;
  c.positive_tabindex = (s.match(/tabindex="[1-9]/g) || []).length;
  c.inline_handler = (s.match(/\son[a-z]+="/gi) || []).length;
  c.status_region = /role="status"|aria-live=/.test(s) ? 0 : 1;
  return c;
}

function pages() {
  const list = fs.readdirSync(PUB).filter((f) => f.endsWith('.html')).sort();
  if (fs.existsSync(path.join(PUB, 'field', 'index.html'))) list.push('field/index.html');
  return list;
}

function scan() {
  const out = {};
  for (const f of pages()) {
    const s = fs.readFileSync(path.join(PUB, f), 'utf8');
    if (isStub(s)) continue;
    out[f] = check(s);
  }
  return out;
}

function renderDoc(base) {
  const L = ['# Static accessibility floor — all pages (F-UX-10)', '',
    '**Generated** by `node tools/agent/a11y-legacy.js --write` from `tests/fixtures/a11y-legacy-baseline.json` — do not edit by hand.',
    '`tests/a11y-legacy-ratchet.test.js` fails when a page gets WORSE than this table; a lower count passes and should be',
    'locked in with `--write`. This is a string check (no browser, no assistive technology) and **not** a WCAG',
    'conformance statement — that is the accessibility lead\'s call after a manual audit.', '',
    'Columns: missing `<html lang>` · missing viewport · no skip link (own or the shell\'s) · no `<main>` · form controls without a',
    'label / aria-label / title · images without `alt` · positive `tabindex` · inline `on…=` handlers · no live status region.', '',
    '| Page | ' + RULES.join(' | ') + ' | total |', '|' + '---|'.repeat(RULES.length + 2)];
  const tot = Object.fromEntries(RULES.map((r) => [r, 0]));
  for (const [f, c] of Object.entries(base)) {
    const t = RULES.reduce((a, r) => a + c[r], 0);
    RULES.forEach((r) => { tot[r] += c[r]; });
    L.push(`| ${f} | ${RULES.map((r) => c[r] || '·').join(' | ')} | ${t} |`);
  }
  L.push(`| **all (${Object.keys(base).length} pages)** | ${RULES.map((r) => tot[r]).join(' | ')} | ${RULES.reduce((a, r) => a + tot[r], 0)} |`, '');
  return L.join('\n');
}

module.exports = { check, scan, renderDoc, RULES, BASELINE, DOC };

if (require.main === module) {
  const argv = process.argv.slice(2);
  if (argv.includes('--write')) {
    const cur = scan();
    fs.writeFileSync(BASELINE, JSON.stringify({ note: 'F-UX-10 — static a11y counts per page; may only go down. Regenerate with node tools/agent/a11y-legacy.js --write.', pages: cur }, null, 1) + '\n');
    fs.writeFileSync(DOC, renderDoc(cur));
    console.log('written ' + path.relative(ROOT, BASELINE) + ' and ' + path.relative(ROOT, DOC));
  } else if (argv.includes('--check')) {
    const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8')).pages;
    const ok = fs.existsSync(DOC) && fs.readFileSync(DOC, 'utf8') === renderDoc(base);
    if (!ok) { console.error('docs/ux/A11Y-LEGACY.md is out of date — node tools/agent/a11y-legacy.js --write'); process.exit(1); }
  } else {
    console.log(JSON.stringify(scan(), null, 1));
  }
}
