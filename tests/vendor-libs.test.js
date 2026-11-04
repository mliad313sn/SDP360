'use strict';
// B-01 — front-end libraries are same-origin: no production page needs the Internet to render a chart
// or the activity tracker. Dev previews (dashboard-preview/, design-system/) are out of scope.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const VENDOR = path.join(PUBLIC, 'vendor');
const manifest = JSON.parse(fs.readFileSync(path.join(VENDOR, 'VENDOR.json'), 'utf8'));

function trackedHtml() {
  let files;
  try {
    files = execFileSync('git', ['ls-files', '-z', '--', 'public'], { cwd: ROOT, encoding: 'utf8' }).split('\0');
  } catch {
    // not a git checkout (installer payload): walk the folder
    files = [];
    (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else files.push(path.relative(ROOT, p).split(path.sep).join('/')); } })(PUBLIC);
  }
  return files.filter((f) => f.endsWith('.html') && !/^public\/(dashboard-preview|design-system)\//.test(f));
}

test('no production page loads a script or stylesheet from another origin', () => {
  const pages = trackedHtml();
  assert.ok(pages.length > 30, `found ${pages.length} pages`);
  const offenders = [];
  for (const f of pages) {
    const html = fs.readFileSync(path.join(ROOT, f), 'utf8');
    if (/src="http/i.test(html)) offenders.push(`${f}: src="http…`);
    if (/\/\/cdn/i.test(html)) offenders.push(`${f}: //cdn…`);
    if (/unpkg\.com/i.test(html) && /<script[^>]+unpkg/i.test(html)) offenders.push(`${f}: unpkg script`);
  }
  assert.deepStrictEqual(offenders, []);
});

test('every vendored file matches its recorded SHA-256 and has its licence alongside', () => {
  for (const lib of manifest.libraries) {
    for (const [rel, meta] of Object.entries(lib.files)) {
      const buf = fs.readFileSync(path.join(VENDOR, rel));
      assert.strictEqual(crypto.createHash('sha256').update(buf).digest('hex'), meta.sha256, rel);
      const dir = path.dirname(path.join(VENDOR, rel));
      assert.ok(fs.readdirSync(dir).some((n) => /^LICEN[CS]E/i.test(n)), `licence next to ${rel}`);
    }
    assert.match(lib.npm_integrity, /^sha512-/, lib.name);
  }
});

test('no file under public/vendor/ is unrecorded', () => {
  const recorded = new Set(manifest.libraries.flatMap((l) => Object.keys(l.files)));
  const extra = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else {
        const rel = path.relative(VENDOR, p).split(path.sep).join('/');
        if (rel !== 'VENDOR.json' && !/^LICEN[CS]E/i.test(e.name) && !recorded.has(rel)) extra.push(rel);
      }
    }
  })(VENDOR);
  assert.deepStrictEqual(extra, []);
});

test('one Chart.js version everywhere, and every vendor/ reference resolves to a file', () => {
  const versions = new Set();
  const missing = [];
  for (const f of trackedHtml()) {
    const html = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const m of html.matchAll(/src="(?:\.\.\/|\/)?vendor\/([^"?]+)"/g)) {
      if (!fs.existsSync(path.join(VENDOR, m[1]))) missing.push(`${f}: ${m[1]}`);
      const cv = /^chart\.js\/([^/]+)\//.exec(m[1]);
      if (cv) versions.add(cv[1]);
    }
  }
  assert.deepStrictEqual(missing, []);
  assert.deepStrictEqual([...versions], ['4.4.1']);
});

test('the licence inventory records the three vendored libraries', () => {
  const csv = fs.readFileSync(path.join(ROOT, 'docs', 'sdp360', 'completion', 'LICENCE-INVENTORY.csv'), 'utf8');
  for (const [name, v] of [['Chart.js', '4.4.1'], ['chartjs-plugin-datalabels', '2.2.0'], ['React / ReactDOM', '18.3.1']]) {
    const line = csv.split('\n').find((l) => l.startsWith(`"bundled","${name}","${v}"`));
    assert.ok(line && /vendored/.test(line), `${name} ${v} recorded as vendored`);
  }
});
