'use strict';
// P08 §5 — "unknown is never 0" sweep. Every server-side reader / composer line that turns a missing value
// into 0 (`|| 0`, `?? 0`, `COALESCE(…, 0)`) must be JUSTIFIED (a rule below, or a reviewed note in the
// baseline) or FIXED. The baseline docs/agent-execution/P08-unknown-sweep.json is a RATCHET: a new hit that no
// rule classifies and the baseline does not list fails tests/kpi-unknown-sweep.test.js.
//
//   node tools/kpi/unknown-sweep.js            summary by category (stdout)
//   node tools/kpi/unknown-sweep.js --check    exit 1 when a hit is neither rule-justified nor in the baseline
//   node tools/kpi/unknown-sweep.js --write    rewrite the baseline (keeps every reviewed note already there)
//   node tools/kpi/unknown-sweep.js --md       markdown table of every hit (evidence)
//
// Scope = the code that READS or COMPOSES figures on the server: root *.js, services/**, routes/**.
// Out of scope (listed in the evidence, not swept): public/** browser pages, tests, tools, docs, vendor.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const BASELINE = path.join(ROOT, 'docs', 'agent-execution', 'P08-unknown-sweep.json');
const PATTERN = /\|\|\s*0(?![.\d])|\?\?\s*0(?![.\d])|COALESCE\([^)]*,\s*0\)/;

function files() {
  const out = [];
  for (const f of fs.readdirSync(ROOT)) if (f.endsWith('.js') && fs.statSync(path.join(ROOT, f)).isFile()) out.push(f);
  const walk = (d) => { for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) { const p = d + '/' + e.name; if (e.isDirectory()) walk(p); else if (e.name.endsWith('.js')) out.push(p); } };
  walk('services'); walk('routes');
  return out.sort();
}

// Ordered rules: the first that matches classifies the hit. Each carries the justification printed in the dossier.
const RULES = [
  { id: 'comment', why: 'Inside a comment — no code.', test: (t) => /^\s*(\/\/|\*|\/\*)/.test(t) || (t.indexOf('//') >= 0 && !PATTERN.test(t.slice(0, t.indexOf('//')))) },
  { id: 'driver_rowcount', why: 'Rows affected reported by the database driver (sqlite `changes` / pg `rowCount`): absent means nothing was written.', test: (t) => /\b(changes|rowCount|inserted|deleted)\b/.test(t) && !/COUNT\(\*\)/.test(t) },
  { id: 'tally', why: 'Counter / accumulator initialiser: the first occurrence of a key starts at 0 before +1 / +n. Nothing unknown is involved.', test: (t) => /\|\|\s*0\)\s*\+\s*(1\b|[a-zA-Z_.]+\b)/.test(t) || /\+=\s*[^;]*\|\|\s*0/.test(t) || /\.reduce\(/.test(t) || /\b(acc|tot|sum|total|cur|cpv|cac)\s*\+=/.test(t) || /=\s*\(\w+\[[^\]]+\]\s*\|\|\s*0\)\s*\+/.test(t) || /r2\(\(m\[cur\]/.test(t) },
  { id: 'ordering', why: 'Sort comparator / ranking key only — never displayed as a figure.', test: (t) => /\.sort\(|localeCompare|\(\s*b\.\w+\s*\|\|\s*0\)\s*-\s*\(\s*a\.|\(a, b\)|\(x, y\)|rank = /.test(t) },
  { id: 'sequence', why: 'Next version / reference / ordinal number (max + 1): an identifier, not a measure.', test: (t) => /version|\bord\b|seq|\bref\b|MAX\(|maxSort|\+ 1;|\) \+ 1\b/.test(t) },
  { id: 'parameter', why: 'Request / layout / policy parameter defaulting (offset, limit, horizon, cooldown, grace, tolerance, coordinates): not a measured value.', test: (t) => /offset|limit|\$skip|\$top|horizon|uplift|cooldown|grace|tolerance|olderThan|minCell|display_order|o\.y|tileH|\bgap\b|\bh = h|after_days|overdueDays|opts\.y|\by = |streak|quota|salvage|\bsv = |LagFormat|LinkLag|lag_hr|leveling|delays|shift|duration_days|start\[|weight|threshold/.test(t) },
  { id: 'sql_flag', why: 'SQL null-key or boolean normalisation (COALESCE(flag,0)=1, COALESCE(site_id,0)=? to match a NULL site, COALESCE(MAX(id),0) for an empty table) — no figure is produced.', test: (t) => /COALESCE\((overdue_status|site_id|MAX\(id\)|i\.n|a\.n),\s*0\)/.test(t) },
  { id: 'time_parse', why: 'Date / time component parsing (missing seconds = 0, cache timestamp absent = never) — not a KPI.', test: (t) => /m\[6\]|tp\[[0-2]\]|\bts\b\s*\|\||_rawCache\.ts|expiresAt|saved\.ts|\bmi\b = tp/.test(t) },
  { id: 'engine_input', why: 'Activity-tracker engine input cell: an empty month cell IS an entry of 0 in the engine contract (byte-identical twin of engine.js).', test: (t, f) => f === 'tracker-pptx.js' || f === 'tracker-db.js' },
  { id: 'count_field', why: 'Count of rows read from a COUNT/SUM (zero rows = a measured zero, the SQL SUM of no row being NULL). The enclosing block is null / absent when the source is not measured (the gate is upstream), so this 0 is never "unknown".', test: (t) => /\b(n|count|total|open|high|closed|inbound|resolved|new|pvs|depts|esc_open|escalat\w*|overdue\w*|tickets|missed|incidents|critical\w*|minor|major|ok|opp|na|submitted\w*|sites_\w+|sent\w*|responded|responses|promoters|passives|detractors|satisfied|neutral|dissatisfied|scored|incidents|srs|reopen_count|d0|d31|d46|d60|t0_30|t31_45|t46_60|tOver60|o|c|issue_count|action_count|standing_\w+|resolved_\w+|new_\w+|actions_\w+|high_open|open_issues|resolved_month|new_month|escalations_open|pvs_held|depts_with_pv|created|backlog|sla_overdue|major_incidents|successful|failed|cancelled|deferred|pending|executed|emergency|current_load|inspections_done|findings_critical_major|never|over90|d30_90|d7_30|under7|gaps_\w+|ous_touched|retirement_candidates|active|g|a|r|technicians|ticket_count|views|breaches|attempts|errors|would_deactivate|rows|unread|active_major_incidents|open_incidents|opened|monitor_count|real_monitor_count|ram_total_gb|eligible|no_currency|outlier|no_\w+|service_request|Requests|tickets_90d|imported|existing_actual|hours|amount|progress_pct|completed|rejected|approved|current|previous|months|kept_unresolved|blocked|counts\.\w+)\b\s*(\)|\]|\s)*(\|\||\?\?)\s*0/.test(t) },
];

// A line that touches a RATIO / SCORE / AVERAGE is never auto-justified: it needs a reviewed note (or a fix).
const MEASURE = /_pct\(|\w*pct\w*\s*[:=]|\bpct\b|score|\bavg|median|percent|ratio|rate\b/i;
function classify(text, file) {
  if (RULES[0].test(text, file)) return RULES[0];
  if (MEASURE.test(text)) return null;
  for (const r of RULES) if (r.test(text, file)) return r;
  return null;
}

function scan() {
  const hits = [];
  for (const f of files()) {
    const lines = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n').split('\n');
    const seen = new Map();
    lines.forEach((ln, i) => {
      if (!PATTERN.test(ln)) return;
      const text = ln.trim().replace(/\s+/g, ' ');
      const h = crypto.createHash('sha1').update(text).digest('hex').slice(0, 12);
      const n = (seen.get(h) || 0) + 1; seen.set(h, n);
      const rule = classify(ln, f);
      hits.push({ key: `${f}|${h}|${n}`, file: f, line: i + 1, text: text.slice(0, 220), rule: rule ? rule.id : null });
    });
  }
  return hits;
}

function loadBaseline() { try { return JSON.parse(fs.readFileSync(BASELINE, 'utf8')); } catch (_) { return { reviewed: {} }; } }

/** { hits, unjustified, byCategory } — a hit is justified by a rule or by a reviewed baseline note. */
function check() {
  const hits = scan(); const base = loadBaseline(); const reviewed = base.reviewed || {};
  const unjustified = hits.filter((h) => !h.rule && !reviewed[h.key]);
  const byCategory = {};
  for (const h of hits) { const c = h.rule || (reviewed[h.key] ? 'reviewed:' + reviewed[h.key].verdict : 'UNJUSTIFIED'); byCategory[c] = (byCategory[c] || 0) + 1; }
  return { hits, unjustified, byCategory, reviewed };
}

if (require.main === module) {
  const a = process.argv.slice(2); const r = check();
  if (a.includes('--write')) {
    const base = loadBaseline(); const reviewed = {};
    for (const h of r.hits) if (!h.rule) reviewed[h.key] = (base.reviewed || {})[h.key] || { verdict: 'TODO', note: 'not yet reviewed', text: h.text };
    for (const k of Object.keys(reviewed)) reviewed[k].text = (r.hits.find((h) => h.key === k) || {}).text || reviewed[k].text;
    fs.writeFileSync(BASELINE, JSON.stringify({ generated_by: 'tools/kpi/unknown-sweep.js --write', rules: RULES.map((x) => ({ id: x.id, why: x.why })), total_hits: r.hits.length, reviewed }, null, 1) + '\n');
    console.log(`baseline written: ${Object.keys(reviewed).length} reviewed entries, ${r.hits.length} hits`);
  } else if (a.includes('--md')) {
    console.log('| File:line | Code | Verdict | Justification |\n|---|---|---|---|');
    for (const h of r.hits) { const rule = RULES.find((x) => x.id === h.rule); const rv = r.reviewed[h.key];
      console.log(`| ${h.file}:${h.line} | \`${h.text.replace(/\|/g, '\\|').slice(0, 110)}\` | ${h.rule ? 'justified (' + h.rule + ')' : rv ? rv.verdict : 'UNJUSTIFIED'} | ${(rule ? rule.why : rv ? rv.note : '').replace(/\|/g, '\\|')} |`); }
  } else {
    console.log(JSON.stringify({ total: r.hits.length, byCategory: r.byCategory, unjustified: r.unjustified.length }, null, 1));
    if (a.includes('--check') && (r.unjustified.length || r.hits.some((h) => !h.rule && r.reviewed[h.key] && r.reviewed[h.key].verdict === 'TODO'))) {
      for (const h of r.unjustified) console.error(`UNJUSTIFIED ${h.file}:${h.line}  ${h.text}`);
      process.exit(1);
    }
  }
}
module.exports = { scan, check, classify, RULES, PATTERN, BASELINE };
