#!/usr/bin/env node
'use strict';
// P06 — map of the two monoliths (server.js inline routes, reports-db.js exports).
// For each server.js route block: method, path, domain, guards on the call line, top-level server.js
// helpers it closes over, the test files that name its path, and how many distinct commits in the
// last N days touched its lines (git blame — the collision proxy used to order extractions).
// For each reports-db.js export: its line range, the tables it names, the tests that call it, and the
// same recent-commit count. Read-only; writes docs/agent-execution/P06-monolith-map.{json,md}.
//   node tools/agent/monolith-map.js [--days=30] [--stdout]
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const DAYS = Number((process.argv.find((a) => a.startsWith('--days=')) || '--days=30').split('=')[1]) || 30;

function read(f) { return fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n'); }

// line (1-based) -> commit date (unix seconds) and sha, from one porcelain blame pass.
function blame(file) {
  const out = { sha: [], time: [] };
  let txt = '';
  try { txt = execFileSync('git', ['blame', '--line-porcelain', file], { cwd: ROOT, maxBuffer: 256 * 1024 * 1024 }).toString(); }
  catch { return null; }
  let sha = null, line = 0; const times = {};
  for (const l of txt.split('\n')) {
    const h = /^([0-9a-f]{40}) \d+ (\d+)/.exec(l);
    if (h) { sha = h[1]; line = Number(h[2]); continue; }
    const t = /^committer-time (\d+)/.exec(l);
    if (t) { times[sha] = Number(t[1]); continue; }
    if (l.startsWith('\t')) { out.sha[line] = sha; out.time[line] = times[sha]; }
  }
  return out;
}

function recentCommits(bl, from, to, since) {
  if (!bl) return null;
  const s = new Set();
  for (let i = from; i <= to; i++) if (bl.time[i] && bl.time[i] >= since) s.add(bl.sha[i]);
  return s.size;
}

// Test files and their text, loaded once.
const TESTS = fs.readdirSync(path.join(ROOT, 'tests')).filter((f) => f.endsWith('.js') || f.endsWith('.mjs'))
  .map((f) => ({ f, s: fs.readFileSync(path.join(ROOT, 'tests', f), 'utf8') }));
function testsNaming(needle) {
  if (!needle || needle.length < 6) return [];
  return TESTS.filter((t) => t.s.includes(needle)).map((t) => t.f);
}

function domainOf(p) {
  const seg = p.split('/').filter(Boolean);
  if (seg[0] !== 'api') return seg[0] ? 'page:' + seg[0].replace(/\.html$/, '') : 'root';
  if (seg[1] === 'reports' && seg[2] && !seg[2].startsWith(':')) return 'reports/' + seg[2];
  return seg[1] || 'api';
}

function mapServer(since) {
  const L = read('server.js');
  const src = L.join('\n');
  // top-level helpers declared in server.js
  const helpers = new Set();
  for (const l of L) {
    const m = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/.exec(l);
    if (m) helpers.add(m[1] || m[2]);
  }
  const starts = [];
  L.forEach((l, i) => {
    const m = /^\s*app\.(get|post|put|patch|delete|all)\(\s*(?:\[\s*)?(['"`])([^'"`]+)\2/.exec(l);
    if (m) starts.push({ i, method: m[1].toUpperCase(), path: m[3] });
  });
  const bl = blame('server.js');
  const routes = starts.map((s, k) => {
    // block ends at the first line that closes the call at the same indent ("});" / "})") before the next start
    const indent = /^(\s*)/.exec(L[s.i])[1];
    const limit = k + 1 < starts.length ? starts[k + 1].i - 1 : L.length - 1;
    let end = s.i;
    if (!/\)\s*;?\s*(\/\/.*)?$/.test(L[s.i]) || /=>\s*\{\s*$|\{\s*$/.test(L[s.i])) {
      for (let j = s.i + 1; j <= limit; j++) { if (L[j].startsWith(indent + '})') || L[j].startsWith(indent + '}));')) { end = j; break; } end = j; }
    }
    const body = L.slice(s.i, end + 1).join('\n');
    const guards = (L[s.i].match(/\brequire[A-Z]\w*(?:\([^)]*\))?|_xp\([^)]*\)/g) || []).filter((g) => g !== 'require');
    const used = [...helpers].filter((h) => h.length > 2 && new RegExp('(^|[^\\w$.])' + h.replace(/\$/g, '\\$') + '\\b').test(body)
      && !/^require[A-Z]/.test(h) && h !== 'app');
    const lit = s.path.split('/:')[0].replace(/\/$/, '');
    return {
      method: s.method, path: s.path, domain: domainOf(s.path), line: s.i + 1, end: end + 1,
      lines: end - s.i + 1, guards, helpers: used, tests: testsNaming(lit),
      recent_commits: recentCommits(bl, s.i + 1, end + 1, since),
    };
  });
  return { lines: L.length, routes, helpers_declared: helpers.size, src_len: src.length };
}

function mapReportsDb(since) {
  const L = read('reports-db.js');
  const exp = L.findIndex((l) => /^module\.exports\s*=\s*\{/.test(l));
  const names = new Set();
  for (let i = exp; i < L.length; i++) {
    for (const t of L[i].replace(/\/\/.*$/, '').split(',')) {
      const m = /^\s*([A-Za-z_$][\w$]*)\s*(?::\s*([A-Za-z_$][\w$]*))?\s*$/.exec(t.replace(/[{}];?/g, ''));
      if (m) names.add(m[1]);
    }
  }
  const defs = [];
  L.forEach((l, i) => {
    const m = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|^(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=/.exec(l);
    if (m) defs.push({ name: m[1] || m[2], i });
  });
  const bl = blame('reports-db.js');
  const fns = [];
  defs.forEach((d, k) => {
    if (!names.has(d.name)) return;
    const end = (k + 1 < defs.length ? defs[k + 1].i : exp) - 1;
    const body = L.slice(d.i, end + 1).join('\n');
    const tables = [...new Set((body.match(/\b(?:FROM|INTO|UPDATE|JOIN)\s+([a-z_][a-z0-9_]+)/gi) || [])
      .map((x) => x.split(/\s+/)[1].toLowerCase()))].filter((t) => !['select', 'set', 'the', 'json_each'].includes(t));
    const domain = /system_log|SystemLog/.test(d.name) ? 'system-log' : /RateLimit|rate_limit/i.test(d.name + body.slice(0, 400)) ? 'rate-limit'
      : (tables[0] || 'misc');
    fns.push({ name: d.name, line: d.i + 1, end: end + 1, lines: end - d.i + 1, tables, domain,
      tests: TESTS.filter((t) => new RegExp('\\b' + d.name + '\\b').test(t.s)).map((t) => t.f).slice(0, 12),
      recent_commits: recentCommits(bl, d.i + 1, end + 1, since) });
  });
  return { lines: L.length, exports: names.size, functions: fns };
}

function rollup(items, key) {
  const m = {};
  for (const r of items) {
    const k = r[key];
    m[k] = m[k] || { domain: k, items: 0, lines: 0, recent_commits_max: 0 };
    m[k].items++; m[k].lines += r.lines; m[k].recent_commits_max = Math.max(m[k].recent_commits_max, r.recent_commits || 0);
  }
  return Object.values(m).sort((a, b) => b.recent_commits_max - a.recent_commits_max || b.lines - a.lines);
}

function main() {
  const since = Math.floor(Date.now() / 1000) - DAYS * 86400;
  const server = mapServer(since), rdb = mapReportsDb(since);
  const out = {
    generated_by: 'tools/agent/monolith-map.js', window_days: DAYS,
    server: { lines: server.lines, inline_routes: server.routes.length, by_domain: rollup(server.routes, 'domain'), routes: server.routes },
    reports_db: { lines: rdb.lines, exports: rdb.exports, by_domain: rollup(rdb.functions, 'domain'), functions: rdb.functions },
  };
  if (process.argv.includes('--stdout')) { process.stdout.write(JSON.stringify(out, null, 1)); return; }
  const dir = path.join(ROOT, 'docs', 'agent-execution');
  fs.writeFileSync(path.join(dir, 'P06-monolith-map.json'), JSON.stringify(out, null, 1) + '\n');
  const md = [];
  md.push('# P06 — monolith map (generated)', '', `Generated by \`node tools/agent/monolith-map.js\` (window ${DAYS} days). Do not edit by hand.`, '');
  md.push(`server.js: ${server.lines} lines, ${server.routes.length} inline route registrations.`, '');
  md.push('| server.js domain | routes | lines | max distinct commits on one route (window) |', '|---|---:|---:|---:|');
  for (const d of out.server.by_domain) md.push(`| ${d.domain} | ${d.items} | ${d.lines} | ${d.recent_commits_max} |`);
  md.push('', `reports-db.js: ${rdb.lines} lines, ${rdb.exports} exported names, ${rdb.functions.length} mapped definitions.`, '');
  md.push('| reports-db.js domain (first table named) | functions | lines | max distinct commits (window) |', '|---|---:|---:|---:|');
  for (const d of out.reports_db.by_domain.slice(0, 40)) md.push(`| ${d.domain} | ${d.items} | ${d.lines} | ${d.recent_commits_max} |`);
  md.push('', 'Per-route and per-function detail (helpers closed over, tests naming the path or function): `P06-monolith-map.json`.', '');
  fs.writeFileSync(path.join(dir, 'P06-monolith-map.md'), md.join('\n'));
  console.log(`server.js ${server.lines} lines / ${server.routes.length} routes; reports-db.js ${rdb.lines} lines / ${rdb.functions.length} exports mapped`);
}

if (require.main === module) main();
module.exports = { mapServer, mapReportsDb, domainOf };
