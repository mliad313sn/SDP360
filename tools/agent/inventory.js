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
//   node tools/agent/inventory.js --strict [--check]   strict coverage signal + criticality (inventory-strict.js)
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

// ---- reachability (E-U04, audit U-07 / X-UX-01) ---------------------------------------------------------
// "Not in navigation" (the old figure) only looked at _shell.js. A page can also be reached from a module tab
// strip (public/module-tabs.js), from a link in another page or page script, or be DEEP-LINK ONLY by design
// (an editor opened with ?id=, the login page). Every page must have one of those; a page with none is a
// dead end and fails tests/inventory-reachability.test.js unless it is allow-listed here WITH a reason.
const DEEP_LINK_ONLY = {
  'login.html': 'sign-in page: reached by redirect from every gated page (auth.js), not from a menu',
  'no-access.html': 'denial page: reached by redirect from auth.js when a role is missing',
  'exec-view.html': 'public IT status snapshot: reached from the SharePoint Quick Link, outside the app',
  'itsm-roadmap.html': "the manager's personal roadmap tool: reached by its URL (bookmark), deliberately outside the shared menu",
  'workspace-settings.html': 'workspace settings: the header "My workspace" link is drawn by _shell.js only while workspace_profiles_enabled = 1 (not visible to this static scan); 404 while off',
};
// RATCHET — pages that have NO entry point today and are not deep-link only by design. They are listed so
// the inventory says so; tests/inventory-reachability.test.js fails if a page is ADDED here or if one becomes
// reachable and stays listed. Where to link them is a navigation decision for a person (E-U04 evidence).
const KNOWN_DEAD_ENDS = {
  'coverage.html': 'duty coverage page — no menu entry, no link from another page',
  'kpi-builder.html': 'KPI policy builder (kpi-committee) — only named in the role help text of the Users card',
  'site-report.html': 'live site scoreboard — no link from the app (the coordinator e-mail names it but carries no link)',
};
const HREF_RE = /(?:href\s*[:=]\s*|location(?:\.href)?\s*=\s*|location\.(?:assign|replace)\(\s*|url=)['"`]?(?:\/)?([a-z0-9][a-z0-9._-]*\.html)/gi;
function linkedPages(src) {
  const out = new Set();
  let m;
  HREF_RE.lastIndex = 0;
  while ((m = HREF_RE.exec(src))) out.add(m[1]);
  return out;
}
/**
 * Pure: pages [{name, src}], shell source, module-tabs source, extra scripts [{file, src}] (page scripts).
 * → Map name → { shell, module_tab, linked_from:[...], redirect_to, deep_link_only, parent, reachable }.
 */
function reachability({ pages, shell, moduleTabs, scripts, allow, deadEnds }) {
  const allowList = allow || DEEP_LINK_ONLY;
  const known = deadEnds || KNOWN_DEAD_ENDS;
  const shellHrefs = new Set((String(shell || '').match(/href:\s*'([^']+)'/g) || []).map((x) => x.replace(/href:\s*'|'/g, '').split(/[?#]/)[0]));
  const tabHrefs = new Map(); // page → first page of its module strip (the module hub)
  const MOD_RE = /\b([a-z_]+)\s*:\s*\[([\s\S]*?)\n\s*\]/g;
  let mm;
  while ((mm = MOD_RE.exec(String(moduleTabs || '')))) {
    const hrefs = (mm[2].match(/href:\s*'([^']+)'/g) || []).map((x) => x.replace(/href:\s*'|'/g, '').split(/[?#]/)[0]);
    for (const h of hrefs) if (!tabHrefs.has(h)) tabHrefs.set(h, hrefs[0]);
  }
  const names = new Set(pages.map((p) => p.name));
  const linked = new Map();
  const add = (target, from) => { if (!names.has(target) || target === from) return; if (!linked.has(target)) linked.set(target, new Set()); linked.get(target).add(from); };
  const redirectOf = {};
  for (const p of pages) {
    const r = /http-equiv="refresh"[^>]*url=([a-z0-9._-]+\.html)/i.exec(p.src)
      || (p.src.length < 2000 ? /<script[^>]*>\s*location\.replace\(\s*'([a-z0-9._-]+\.html)/i.exec(p.src) : null);
    if (r) redirectOf[p.name] = r[1];
    for (const t of linkedPages(p.src)) add(t, p.name);
  }
  for (const s of scripts || []) for (const t of linkedPages(s.src)) add(t, s.file);
  const out = new Map();
  for (const p of pages) {
    const from = [...(linked.get(p.name) || [])].sort();
    const shellNav = shellHrefs.has(p.name);
    const tab = tabHrefs.has(p.name);
    const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
    let deep = own(allowList, p.name) ? allowList[p.name] : null;
    // A meta-refresh stub exists for old bookmarks; it is deep-link only when its target is a real page.
    if (!deep && redirectOf[p.name] && names.has(redirectOf[p.name])) deep = 'legacy redirect stub kept for old bookmarks → ' + redirectOf[p.name];
    const parent = shellNav ? 'shell' : (tab ? tabHrefs.get(p.name) : (from.find((f) => f.endsWith('.html')) || from[0] || null));
    out.set(p.name, { shell: shellNav, module_tab: tab, linked_from: from, redirect_to: redirectOf[p.name] || null,
      deep_link_only: deep, known_dead_end: own(known, p.name) ? known[p.name] : null,
      parent: parent === p.name ? 'shell' : (parent || (redirectOf[p.name] || null)),
      reachable: shellNav || tab || from.length > 0 || !!deep });
  }
  return out;
}

function build() {
  const tests = testIndex();
  const shell = fs.existsSync(path.join(ROOT, 'public', '_shell.js')) ? read(path.join(ROOT, 'public', '_shell.js')) : '';
  const navHrefs = new Set((shell.match(/href:\s*'([^']+)'/g) || []).map((x) => x.replace(/href:\s*'|'/g, '').split(/[?#]/)[0]));

  const pageFiles = list(path.join(ROOT, 'public'), /\.html$/);
  const mt = path.join(ROOT, 'public', 'module-tabs.js');
  const scripts = walk(path.join(ROOT, 'public'), /\.(js|jsx)$/)
    .filter((f) => !/[\\/](vendor|_shell\.js$|module-tabs\.js$)/.test(f) && !/[\\/]vendor[\\/]/.test(f))
    .map((f) => ({ file: rel(f).replace(/^public\//, ''), src: read(f) }));
  const reach = reachability({ pages: pageFiles.map((f) => ({ name: path.basename(f), src: read(f) })), shell,
    moduleTabs: fs.existsSync(mt) ? read(mt) : '', scripts });

  const pages = pageFiles.map((f) => {
    const name = path.basename(f);
    const src = read(f);
    const req = (src.match(/data-require="([^"]+)"/) || [])[1] || null;
    const inlineScripts = (src.match(/<script(?![^>]*\bsrc=)[^>]*>/g) || []).filter((t) => !/type="(?:text\/html|application\/json|application\/ld\+json)"/.test(t)).length;
    return {
      id: 'PG-' + slug(name.replace(/\.html$/, '')),
      page: 'public/' + name,
      requires: req ? req.split('|') : (name === 'login.html' || name === 'no-access.html' || name === 'exec-view.html' ? ['public'] : ['UNKNOWN']),
      in_navigation: navHrefs.has(name),
      entry_points: (() => { const r = reach.get(name); return { shell: r.shell, module_tab: r.module_tab, linked_from: r.linked_from, redirect_to: r.redirect_to, deep_link_only: r.deep_link_only, known_dead_end: r.known_dead_end }; })(),
      parent: reach.get(name).parent,
      reachable: reach.get(name).reachable,
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
    pages_not_in_shell_or_module_tabs: count(pages, (p) => !p.entry_points.shell && !p.entry_points.module_tab),
    pages_deep_link_only: count(pages, (p) => !!p.entry_points.deep_link_only),
    pages_without_entry_point: count(pages, (p) => !p.reachable),
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
  L.push('', '## Page entry points (E-U04)', '',
    '"Not in navigation" above counts only the shell menu. A page is **reachable** when it is in the shell menu, in a module tab strip (public/module-tabs.js), linked from another page or page script, or allow-listed as deep-link only (with the reason). Parent = where Back / the breadcrumb leads.', '',
    '| Page | Shell | Module tab | Linked from | Redirects to | Deep-link only | Parent |', '|---|---|---|---|---|---|---|');
  for (const p of inv.pages) {
    const e = p.entry_points;
    const lf = e.linked_from.length ? e.linked_from.slice(0, 4).join(', ') + (e.linked_from.length > 4 ? ` (+${e.linked_from.length - 4})` : '') : '—';
    L.push(`| ${p.page} | ${e.shell ? 'yes' : '—'} | ${e.module_tab ? 'yes' : '—'} | ${lf} | ${e.redirect_to || '—'} | ${e.deep_link_only || '—'} | ${p.reachable ? (p.parent || '—') : '**NO ENTRY POINT**' + (e.known_dead_end ? ' — ' + e.known_dead_end : '')} |`);
  }
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
  // F-ARCH-08 — strict coverage signal + criticality classes (docs/agent-execution/INVENTORY-STRICT.md)
  if (process.argv.includes('--strict')) {
    const strict = require('./inventory-strict');
    if (process.argv.includes('--check')) {
      const c = strict.check(inv);
      if (!c.ok) { console.error(c.reason); process.exit(1); }
      console.log('strict inventory up to date: ' + JSON.stringify(c.summary));
      return;
    }
    console.log(JSON.stringify(strict.write(inv).summary));
    return;
  }
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
module.exports = { build, routesOf, literalPrefix, comparable, reachability, linkedPages, DEEP_LINK_ONLY, KNOWN_DEAD_ENDS };
