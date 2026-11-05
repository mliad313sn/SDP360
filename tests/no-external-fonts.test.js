'use strict';
// C-29 — no third-party font request (PO decision P5). Libre Franklin is served same-origin from
// public/vendor/fonts/ (OFL-1.1, recorded in public/vendor/VENDOR.json); every other face falls back to
// the system stack already listed in the page. Nothing under public/ may point at a font host, and no
// Content-Security-Policy may list one.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const FONT_HOSTS = /fonts\.googleapis\.com|fonts\.gstatic\.com|use\.typekit\.net|p\.typekit\.net|fonts\.bunny\.net|fast\.fonts\.net|fonts\.cdnfonts\.com|fonts\.adobe\.com|use\.fontawesome\.com/i;
const TEXT = /\.(html?|css|js|jsx|mjs|json|md|svg|txt|webmanifest)$/i;

function walk(d, out = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, out); else if (TEXT.test(e.name)) out.push(p);
  }
  return out;
}

test('no file under public/ references a third-party font host', () => {
  const files = walk(PUBLIC);
  assert.ok(files.length > 50, `scanned ${files.length} files`);
  const offenders = files.filter((f) => FONT_HOSTS.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(ROOT, f));
  assert.deepStrictEqual(offenders, []);
});

test('no @font-face in public/ loads from another origin', () => {
  const offenders = [];
  for (const f of walk(PUBLIC).filter((x) => /\.(css|html?)$/i.test(x))) {
    const s = fs.readFileSync(f, 'utf8');
    for (const m of s.matchAll(/@font-face\s*{[^}]*}/gi)) if (/url\(\s*['"]?(https?:)?\/\//i.test(m[0])) offenders.push(path.relative(ROOT, f));
    for (const m of s.matchAll(/@import\s+url\(\s*['"]?((https?:)?\/\/[^'")]+)/gi)) offenders.push(`${path.relative(ROOT, f)}: @import ${m[1]}`);
  }
  assert.deepStrictEqual(offenders, []);
});

test('public/fonts.css declares Libre Franklin from vendored files that exist', () => {
  const css = fs.readFileSync(path.join(PUBLIC, 'fonts.css'), 'utf8');
  const urls = [...css.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1].replace(/['"]/g, ''));
  assert.ok(urls.length >= 6, 'weights declared');
  for (const u of urls) {
    assert.match(u, /^vendor\/fonts\//, u);
    assert.ok(fs.existsSync(path.join(PUBLIC, u)), u);
  }
  assert.ok(fs.existsSync(path.join(PUBLIC, 'vendor/fonts/libre-franklin/5.3.0/LICENSE')), 'OFL licence alongside');
  assert.match(fs.readFileSync(path.join(PUBLIC, 'vendor/fonts/libre-franklin/5.3.0/LICENSE'), 'utf8'), /SIL Open Font License, Version 1\.1/);
});

test('no Content-Security-Policy lists a font host (shared directives, report-only, preview override)', () => {
  const sessionAuth = require('../services/sessionAuth');
  const policies = [
    sessionAuth.cspDirectives(sessionAuth.scriptSrc('n0nce', false)).join('; '),
    sessionAuth.cspDirectives(sessionAuth.scriptSrc('n0nce', true)).join('; '),
    sessionAuth.reportOnlyPolicy('n0nce'),
  ];
  for (const p of policies) {
    assert.doesNotMatch(p, FONT_HOSTS, p);
    const font = /font-src ([^;]*)/.exec(p);
    assert.ok(font, 'font-src present');
    assert.strictEqual(font[1].trim(), "'self' data:");
    assert.doesNotMatch(/style-src ([^;]*)/.exec(p)[1], /\./, 'style-src lists no host');
  }
  // server.js builds its own policy for the preview / activity-tracker paths — no font host there either.
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8'), FONT_HOSTS);
});
