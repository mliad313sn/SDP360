'use strict';
// F-ARCH-06 — CSP readiness per journey. For each journey of docs/ops/PERSONA-JOURNEYS.md, the pages it uses,
// what still blocks a nonce-only script-src on each page (inline <script> blocks, inline event handlers) and
// whether the page is already served strict. Optionally the Content-Security-Policy-Report-Only violations
// recorded in system_log (category security, action csp_violation) are counted per page.
//
//   node tools/security/csp-journey-report.js                       writes docs/security/CSP-JOURNEYS.md (static inventory)
//   node tools/security/csp-journey-report.js --check               exits 1 when that file is out of date
//   node tools/security/csp-journey-report.js --violations <file>   prints the same report with observed counts
//                                                                   (<file> = JSON export of System Logs, rows or {rows})
//
// Reads files only; never a database, never the network. A page is "enforceable" when it has no inline script
// and no inline handler — listing it in report_config.csp_strict_pages is then a decision for the security
// owner, after a report-only run. This tool arms nothing.

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'docs', 'security', 'CSP-JOURNEYS.md');
const JOURNEYS = path.join(ROOT, 'docs', 'ops', 'PERSONA-JOURNEYS.md');
const { STRICT_PAGES } = require('../../services/sessionAuth');

const NON_SCRIPT_TYPE = /type="(?:text\/html|application\/json|application\/ld\+json)"/;

/** Inline <script> blocks (same rule as tools/agent/inventory.js) and inline on*="" handlers of one page source. */
function scanPage(src) {
  const s = String(src || '');
  const inline_scripts = (s.match(/<script(?![^>]*\bsrc=)[^>]*>/g) || []).filter((t) => !NON_SCRIPT_TYPE.test(t)).length;
  const markup = s.replace(/<script\b[\s\S]*?<\/script>/gi, '');   // handlers are counted in the markup, not inside script text
  const inline_handlers = (markup.match(/<[a-zA-Z][^>]*?\son[a-z]+\s*=\s*["']/g) || []).length;
  return { inline_scripts, inline_handlers };
}

/** Rows of the journey table: { persona, journey, pages: ['public/x.html', …] }. */
function parseJourneys(md) {
  const out = [];
  for (const line of String(md).split('\n')) {
    if (!line.startsWith('|') || /^\|\s*(Persona|---)/.test(line)) continue;
    const c = line.split('|').slice(1, -1).map((x) => x.trim());
    if (c.length < 6) continue;
    const pages = [...new Set([c[3], c[4]].map((x) => (/`(public\/[^`]+\.html)`/.exec(x) || [])[1]).filter(Boolean))];
    if (pages.length) out.push({ persona: c[0], journey: c[2].replace(/\s*\((?:E-|C-)[^)]*\)/g, '').slice(0, 140), pages });
  }
  return out;
}

/** System-log rows → Map('/page.html' → count). Accepts an array or { rows }. Unknown shapes are ignored. */
function countViolations(json) {
  const rows = Array.isArray(json) ? json : (json && Array.isArray(json.rows) ? json.rows : []);
  const by = new Map();
  for (const r of rows) {
    if (!r || r.action !== 'csp_violation') continue;
    let d = r.details; if (typeof d === 'string') { try { d = JSON.parse(d); } catch (_) { d = null; } }
    const doc = d && typeof d.document === 'string' ? d.document : String(r.target || '').split(' ').slice(1).join(' ');
    if (!doc || !doc.startsWith('/')) continue;
    by.set(doc, (by.get(doc) || 0) + 1);
  }
  return by;
}

/**
 * @param {{journeys:Array, pages:Object<string,{inline_scripts:number,inline_handlers:number}>, strict:string[], violations?:Map|null}} i
 * pages is keyed by 'public/x.html'. violations null = not measured (shown as "—", never 0).
 */
function build({ journeys, pages, strict, violations = null }) {
  const url = (p) => '/' + p.replace(/^public\//, '');
  const pageRow = (p) => {
    const s = pages[p] || null;
    const isStrict = strict.includes(url(p));
    const state = !s ? 'unknown' : isStrict ? 'strict' : (s.inline_scripts === 0 && s.inline_handlers === 0) ? 'enforceable' : 'blocked';
    return { page: p, url: url(p), inline_scripts: s ? s.inline_scripts : null, inline_handlers: s ? s.inline_handlers : null, state,
      violations: violations ? (violations.get(url(p)) || 0) : null };
  };
  const rows = journeys.map((j) => {
    const ps = j.pages.map(pageRow);
    const state = ps.some((x) => x.state === 'unknown') ? 'unknown' : ps.every((x) => x.state === 'strict') ? 'strict' : ps.every((x) => x.state !== 'blocked') ? 'enforceable' : 'blocked';
    return { persona: j.persona, journey: j.journey, pages: ps, state, blockers: ps.filter((x) => x.state === 'blocked').map((x) => x.url) };
  });
  const used = [...new Set(journeys.flatMap((j) => j.pages))].sort().map(pageRow);
  const count = (st) => rows.filter((r) => r.state === st).length;
  return { rows, pages: used, totals: { journeys: rows.length, strict: count('strict'), enforceable: count('enforceable'), blocked: count('blocked'), unknown: count('unknown') }, measured: !!violations };
}

function render(r) {
  const n = (v) => (v == null ? '—' : String(v));
  const cell = (v) => String(v).replace(/\|/g, '\\|');
  const L = ['# CSP readiness per journey (generated)', '',
    'Generated by `node tools/security/csp-journey-report.js` — do not edit by hand (`--check` fails when this file is out of date).', '',
    'What it shows: for each journey of `docs/ops/PERSONA-JOURNEYS.md`, whether its pages can be served with the nonce-only',
    '`script-src` (no `\'unsafe-inline\'`). A page is **strict** when it is already served that way, **enforceable** when it has no',
    'inline script and no inline event handler, **blocked** otherwise. Enforcement of an enforceable page is a setting',
    '(`report_config.csp_strict_pages`, default empty = today) and a decision of the security owner after a report-only run',
    '(`SDP_CSP_REPORT_ONLY=1`); this file approves nothing. Script origins are never widened: the strict policy is `\'self\'` + a nonce.', '',
    'A page with inline scripts but no inline handler is counted **blocked** here although the server adds the nonce to the script tags',
    'of the pages it renders: treat it as a candidate only after a report-only run shows no violation for it.', '',
    r.measured ? 'Violations: counted from the supplied System Logs export.' : 'Violations: not measured in this file (“—”). Run with `--violations <export.json>` after a report-only period to add observed counts.', '',
    `Journeys: ${r.totals.journeys} — strict ${r.totals.strict}, enforceable ${r.totals.enforceable}, blocked ${r.totals.blocked}, unknown ${r.totals.unknown}.`, '',
    '## Journeys', '', '| Persona | Journey | Pages | State | Blocked by |', '|---|---|---|---|---|'];
  for (const x of r.rows) L.push(`| ${cell(x.persona)} | ${cell(x.journey)} | ${x.pages.map((p) => '`' + p.url + '`').join(', ')} | ${x.state} | ${x.blockers.map((b) => '`' + b + '`').join(', ') || '—'} |`);
  L.push('', '## Pages used by the journeys', '', '| Page | Inline scripts | Inline handlers | State | Report-only violations |', '|---|---|---|---|---|');
  for (const p of r.pages) L.push(`| \`${p.url}\` | ${n(p.inline_scripts)} | ${n(p.inline_handlers)} | ${p.state} | ${n(p.violations)} |`);
  L.push('', '## Order of work (proposal)', '',
    '1. Journeys whose pages are all enforceable: run report-only, then list the pages in `csp_strict_pages`.',
    '2. Blocked pages with the fewest inline handlers first (extract to an external file — E-A02), one journey at a time.',
    '3. A page shared by several journeys unblocks all of them: see the page table.', '');
  return L.join('\n');
}

function collect() {
  const journeys = parseJourneys(fs.readFileSync(JOURNEYS, 'utf8'));
  const pages = {};
  for (const p of new Set(journeys.flatMap((j) => j.pages))) {
    const f = path.join(ROOT, p);
    pages[p] = fs.existsSync(f) ? scanPage(fs.readFileSync(f, 'utf8')) : null;
  }
  return { journeys, pages, strict: STRICT_PAGES.slice() };
}

if (require.main === module) {
  const i = process.argv.indexOf('--violations');
  if (i > 0) {
    const v = countViolations(JSON.parse(fs.readFileSync(process.argv[i + 1], 'utf8')));
    process.stdout.write(render(build({ ...collect(), violations: v })) + '\n');
  } else {
    const text = render(build(collect()));
    if (process.argv.includes('--check')) {
      const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') : '';
      if (cur !== text) { console.error('docs/security/CSP-JOURNEYS.md is out of date — run node tools/security/csp-journey-report.js'); process.exit(1); }
      console.log('CSP journeys: up to date');
    } else { fs.writeFileSync(OUT, text); console.log('wrote ' + path.relative(process.cwd(), OUT)); }
  }
}

module.exports = { scanPage, parseJourneys, countViolations, build, render, collect, OUT };
