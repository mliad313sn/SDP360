#!/usr/bin/env node
'use strict';
// G00 — machine-generated inventory of what the code actually contains: every HTML page (with the role its
// own `data-require` asks for and whether the navigation lists it), every API route (method + path + the
// file that declares it), every scheduled job, every PostgreSQL migration, and for each page/route the test
// files that mention it. Each item has a STABLE id derived from what it is (not from its position), so a
// tracker or a gap register can cite it across commits.
//
// What it does NOT claim: a route mentioned in a test is "referenced by a test", not "proven correct";
// field validation, deployment and business acceptance are never derived from code (see TRUTH-MATRIX.md).
//
// Usage:
//   node tools/agent/inventory.js                write docs/agent-execution/INVENTORY.json + INVENTORY.md
//   node tools/agent/inventory.js --check        exit 1 if the committed inventory differs from the code
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT_JSON = path.join(ROOT, 'docs', 'agent-execution', 'INVENTORY.json');
const OUT_MD = path.join(ROOT, 'docs', 'agent-execution', 'INVENTORY.md');
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const list = (dir, re) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => re.test(f)).sort().map((f) => path.join(dir, f)) : []);
function walk(dir, re, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, re, out); else if (re.test(e.name)) out.push(p);
  }
  return out;
}
const slug = (s) => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();

// ---- routes -------------------------------------------------------------------------------------------
const ROUTE_RE = /\b(?:app|router|r)\.(get|post|put|patch|delete)\(\s*(\[[^\]]*\]|['"`][^'"`]+['"`])/g;
function routesOf(file) {
  const src = read(file);
  const out = [];
  let m;
  ROUTE_RE.lastIndex = 0;
  while ((m = ROUTE_RE.exec(src))) {
    const method = m[1].toUpperCase();
    const raw = m[2];
    const paths = raw.startsWith('[') ? (raw.match(/['"`]([^'"`]+)['"`]/g) || []).map((x) => x.slice(1, -1)) : [raw.slice(1, -1)];
    const line = src.slice(0, m.index).split('\n').length;
    for (const p of paths) if (p.startsWith('/')) out.push({ method, path: p, file: rel(file), line });
  }
  return out;
}

// ---- tests index (which test files mention a string) -----------------------------------------------------
function testIndex() {
  return list(path.join(ROOT, 'tests'), /\.test\.js$/).map((f) => ({ file: rel(f), src: read(f) }));
}
// The part of a route path a test would write literally: up to the first parameter.
function literalPrefix(p) { const i = p.search(/[:*(]/); return (i < 0 ? p : p.slice(0, i)).replace(/\/$/, ''); }
function testsMentioning(tests, needle) {
  if (!needle || needle.length < 4) return [];
  return tests.filter((t) => t.src.includes(needle)).map((t) => t.file);
}

function build() {
  const tests = testIndex();
  const shell = fs.existsSync(path.join(ROOT, 'public', '_shell.js')) ? read(path.join(ROOT, 'public', '_shell.js')) : '';
  const navHrefs = new Set((shell.match(/href:\s*'([^']+)'/g) || []).map((x) => x.replace(/href:\s*'|'/g, '').split(/[?#]/)[0]));

  const pages = list(path.join(ROOT, 'public'), /\.html$/).map((f) => {
    const name = path.basename(f);
    const src = read(f);
    const req = (src.match(/data-require="([^"]+)"/) || [])[1] || null;
    const inlineScripts = (src.match(/<script(?![^>]*\bsrc=)[^>]*>/g) || []).filter((t) => !/type="(?:text\/html|application\/json|application\/ld\+json)"/.test(t)).length;
    return {
      id: 'PG-' + slug(name.replace(/\.html$/, '')),
      page: 'public/' + name,
      requires: req ? req.split('|') : (name === 'login.html' || name === 'no-access.html' || name === 'exec-view.html' ? ['public'] : ['UNKNOWN']),
      in_navigation: navHrefs.has(name),
      inline_scripts: inlineScripts,
      bytes: Buffer.byteLength(src),
      tests: testsMentioning(tests, name),
    };
  });

  const routeFiles = [path.join(ROOT, 'server.js'), ...list(path.join(ROOT, 'routes'), /\.js$/)];
  const seen = new Set();
  const routes = [];
  for (const f of routeFiles) {
    for (const r of routesOf(f)) {
      const id = 'RT-' + r.method + '-' + slug(r.path || 'root');
      if (seen.has(id + '@' + r.file)) continue;
      seen.add(id + '@' + r.file);
      const pre = literalPrefix(r.path);
      routes.push({ id, method: r.method, path: r.path, file: r.file, line: r.line, tests: testsMentioning(tests, pre) });
    }
  }
  routes.sort((a, b) => (a.path + a.method + a.file).localeCompare(b.path + b.method + b.file));

  const jobsSrc = fs.existsSync(path.join(ROOT, 'services', 'sync', 'jobs.js')) ? read(path.join(ROOT, 'services', 'sync', 'jobs.js')) : '';
  const jobs = [...new Set((jobsSrc.match(/legacyJob\('([^']+)'/g) || []).map((x) => x.slice(11, -1)))]
    .concat([...jobsSrc.matchAll(/\bname:\s*'([a-z0-9_.]+)'/g)].map((m) => m[1]))
    .filter((v, i, a) => a.indexOf(v) === i).sort()
    .map((name) => ({ id: 'JB-' + slug(name), job: name, tests: testsMentioning(tests, name) }));

  const migrations = walk(path.join(ROOT, 'db', 'postgres'), /\.sql$/).map((f) => ({ id: 'MG-' + slug(rel(f).replace(/^db\/postgres\//, '').replace(/\.sql$/, '')), file: rel(f) }));

  const count = (arr, pred) => arr.filter(pred).length;
  const summary = {
    pages: pages.length,
    pages_without_test_reference: count(pages, (p) => p.tests.length === 0),
    pages_without_declared_role: count(pages, (p) => p.requires[0] === 'UNKNOWN'),
    pages_not_in_navigation: count(pages, (p) => !p.in_navigation),
    pages_with_inline_scripts: count(pages, (p) => p.inline_scripts > 0),
    routes: routes.length,
    routes_without_test_reference: count(routes, (r) => r.tests.length === 0),
    routes_in_server_js: count(routes, (r) => r.file === 'server.js'),
    jobs: jobs.length,
    jobs_without_test_reference: count(jobs, (j) => j.tests.length === 0),
    migrations: migrations.length,
    test_files: tests.length,
  };
  return { note: 'Generated by tools/agent/inventory.js — do not edit by hand. "tests" = test files that mention the item, not proof of correctness.', summary, pages, routes, jobs, migrations };
}

function markdown(inv) {
  const s = inv.summary;
  const L = [];
  L.push('# Inventory (generated)', '', '`node tools/agent/inventory.js` writes this file; `--check` fails CI when it is out of date.', '',
    '"Tests" means the test files that **mention** the page, route or job. It is a coverage signal, not proof of correctness; field validation, deployment and acceptance are never derived from code.', '',
    '| Item | Count |', '|---|---:|');
  for (const [k, v] of Object.entries(s)) L.push(`| ${k.replace(/_/g, ' ')} | ${v} |`);
  L.push('', '## Pages', '', '| Id | Page | Role required | In nav | Inline scripts | Tests |', '|---|---|---|---|---:|---:|');
  for (const p of inv.pages) L.push(`| ${p.id} | ${p.page} | ${p.requires.join(' / ')} | ${p.in_navigation ? 'yes' : 'no'} | ${p.inline_scripts} | ${p.tests.length} |`);
  L.push('', '## Routes without a test reference', '', '| Id | Method | Path | File:line |', '|---|---|---|---|');
  for (const r of inv.routes.filter((x) => x.tests.length === 0)) L.push(`| ${r.id} | ${r.method} | \`${r.path}\` | ${r.file}:${r.line} |`);
  L.push('', '## Scheduled jobs', '', '| Id | Job | Tests |', '|---|---|---:|');
  for (const j of inv.jobs) L.push(`| ${j.id} | ${j.job} | ${j.tests.length} |`);
  return L.join('\n') + '\n';
}

// Line numbers move with every edit; the check compares the inventory without them.
// The check guards WHAT exists (a new page, route, job or migration must be inventoried), not volatile
// details: line numbers, byte sizes and the list of mentioning tests are refreshed on regeneration.
function comparable(inv) {
  return JSON.stringify({
    pages: inv.pages.map((p) => [p.id, p.page, p.requires.join('|'), p.in_navigation]),
    routes: inv.routes.map((r) => [r.id, r.method, r.path, r.file]),
    jobs: inv.jobs.map((j) => j.id),
    migrations: inv.migrations.map((m) => m.id),
  });
}

function main() {
  const inv = build();
  if (process.argv.includes('--check')) {
    if (!fs.existsSync(OUT_JSON)) { console.error('INVENTORY.json missing — run node tools/agent/inventory.js'); process.exit(1); }
    const committed = JSON.parse(fs.readFileSync(OUT_JSON, 'utf8'));
    if (comparable(committed) !== comparable(inv)) { console.error('INVENTORY.json is out of date — run node tools/agent/inventory.js and commit'); process.exit(1); }
    console.log('inventory up to date: ' + JSON.stringify(inv.summary));
    return;
  }
  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(inv, null, 1) + '\n');
  fs.writeFileSync(OUT_MD, markdown(inv));
  console.log(JSON.stringify(inv.summary));
}
if (require.main === module) main();
module.exports = { build, routesOf, literalPrefix, comparable };
