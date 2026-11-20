'use strict';
// Policy Control Center — the catalogue of every administrable rule (ADR docs/ai-decisions/ADR-POLICY-CENTER.md).
//
// ONE view over the rule stores that already exist — no parallel config system:
//   • report_config keys        (services/reportConfig.js DEFAULTS — global only, written through setConfig)
//   • governance policies       (services/governancePolicy.js PARAMS — global / per site / per group, own store)
//   • KPI RAG policies          (public/lib/kpiRag.js POLICIES — read only here; changed through the KPI policy builder)
// The hand-maintained half (category, risk of deviating, four-eyes, values a consumer accepts) is
// docs/ops/policy-catalogue.json; the rest is read from the code and docs/ops/FLAG-REGISTER.json.
//
// Honesty rules: the best-practice default is the code default (today's behaviour). A recommendation is shown only
// when the flag register carries one, and always as PROPOSED; otherwise "no recommendation yet". Owner roles are
// PROPOSED. A scope is listed only when a consumer reads it (report_config = global only). Consumers are files where
// the key is referenced, scanned from the repository (keys too generic to scan — no "_" or "." — say so).
const fs = require('fs');
const path = require('path');
const { typed } = require('./httpError');

const ROOT = path.join(__dirname, '..');
const CATALOGUE_FILE = path.join(ROOT, 'docs', 'ops', 'policy-catalogue.json');
const REGISTER_FILE = path.join(ROOT, 'docs', 'ops', 'FLAG-REGISTER.json');
const RISKS = ['low', 'medium', 'high'];
const TEXT_MAX = 4000;

const readJson = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return fallback; } };

/** Comment text describing a report_config key in services/reportConfig.js (inline, block above, or `//  key:` line). */
function describeFromSource(src, key) {
  const lines = String(src || '').split('\n');
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const clean = (t) => t.replace(/\s+/g, ' ').trim().slice(0, 500) || null;
  for (const l of lines) {   // a comment line naming the key: "//    key: text" / "// key 'x' = …"
    const m = l.match(new RegExp('^\\s*//\\s*(?:[A-Z0-9-]+\\s+)?' + esc + '\\b[:\\s]+(.*)$'));
    if (m && m[1].trim().length > 5) return clean(m[1]);
  }
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!new RegExp('\\b' + esc + '\\b\\s*[:=]').test(l) || /^\s*\/\//.test(l)) continue;
    const inline = l.split('//')[1];
    if (inline && inline.trim().length > 5) return clean(inline);
    const block = [];   // the comment block right above
    for (let j = i - 1; j >= 0 && /^\s*\/\//.test(lines[j]); j--) block.unshift(lines[j].replace(/^\s*\/\/\s?/, ''));
    if (block.length) return clean(block.join(' '));
  }
  return null;
}

/** Infer the value type of a report_config key from its default (+ catalogue overrides). */
function inferType(def, entry, uiEnums) {
  if (entry && Array.isArray(entry.allowed)) return { type: 'enum', allowed: entry.allowed.slice() };
  if (uiEnums && uiEnums.length) return { type: 'enum', allowed: uiEnums.slice() };
  const d = String(def == null ? '' : def);
  if (entry && entry.type) return { type: entry.type };
  if (d === '0' || d === '1') return { type: 'bool', allowed: ['0', '1'] };
  if (d !== '' && Number.isFinite(Number(d))) return { type: 'number' };
  if (/^\s*[{[]/.test(d)) { try { JSON.parse(d); return { type: 'json' }; } catch (_) { /* text */ } }
  return { type: 'text' };
}

// ── consumers (repo scan, once per process) ─────────────────────────────────────────────────────
let _consumers = null;
function scanConsumers(keys, root = ROOT) {
  const set = new Set(keys);
  const out = new Map();
  const files = [];
  const skip = new Set(['services/reportConfig.js', 'services/governancePolicy.js', 'services/policyCatalogue.js', 'tools/agent/policy-catalogue.js', 'tools/agent/flag-register.js']);
  const walk = (d, re) => {
    let ents = []; try { ents = fs.readdirSync(path.join(root, d), { withFileTypes: true }); } catch (_) { return; }
    for (const e of ents) {
      const rel = d ? d + '/' + e.name : e.name;
      if (e.isDirectory()) { if (!/^(node_modules|vendor|\.git|tests|docs|fixtures|i18n)$/.test(e.name)) walk(rel, re); }
      else if (re.test(e.name) && !skip.has(rel)) files.push(rel);
    }
  };
  for (const f of fs.readdirSync(root)) if (/\.js$/.test(f)) files.push(f);
  walk('routes', /\.js$/); walk('services', /\.js$/); walk('tools', /\.js$/); walk('public', /\.(js|html)$/);
  const re = /['"`.]([a-z0-9_.]{3,80})/g;
  for (const f of files) {
    let src; try { src = fs.readFileSync(path.join(root, f), 'utf8'); } catch (_) { continue; }
    const hit = new Set();
    for (const m of src.matchAll(re)) {   // "a.b.c" → test "a.b.c", "a.b", "a" (a property access chained after the key)
      const parts = m[1].split('.');
      for (let n = parts.length; n > 0; n--) { const k = parts.slice(0, n).join('.'); if (set.has(k)) { hit.add(k); break; } }
    }
    for (const k of hit) { if (!out.has(k)) out.set(k, []); out.get(k).push(f); }
  }
  return out;
}
const scannable = (k) => /[_.]/.test(k);

// ── build ───────────────────────────────────────────────────────────────────────────────────────
let _built = null;
function build({ fresh = false } = {}) {
  if (_built && !fresh) return _built;
  const RC = require('./reportConfig');
  const GP = require('./governancePolicy');
  let UI = null; try { UI = require('./uiPolicy'); } catch (_) { UI = null; }
  const cat = readJson(CATALOGUE_FILE, { categories: {}, keys: {}, excluded: {} });
  const reg = readJson(REGISTER_FILE, { report_config: [], governance_policies: [] });
  const regBy = new Map([...(reg.report_config || []), ...(reg.governance_policies || [])].map((r) => [r.key, r]));
  const src = (() => { try { return fs.readFileSync(path.join(__dirname, 'reportConfig.js'), 'utf8'); } catch (_) { return ''; } })();
  const allKeys = [...RC.KEYS, ...GP.PARAMS.map((p) => p.key)];
  if (!_consumers || fresh) _consumers = scanConsumers(allKeys.filter(scannable));
  const humanize = (k) => { const t = String(k).replace(/[._]+/g, ' ').trim(); return t.charAt(0).toUpperCase() + t.slice(1); };
  const entries = [];
  for (const k of RC.KEYS) {
    if ((cat.excluded || {})[k]) continue;
    const e = (cat.keys || {})[k] || {};
    const r = regBy.get(k) || {};
    const secret = RC._SECRET_BLANK_KEEP.has(k);
    const t = inferType(RC.DEFAULTS[k], e, UI && UI.ENUMS ? UI.ENUMS[k] : null);
    entries.push({
      key: k, source: 'report_config', category: e.category || null,
      title: humanize(k), description_en: describeFromSource(src, k), description_fr: e.description_fr || null,
      type: t.type, allowed: t.allowed || null, min: e.min != null ? e.min : null, max: e.max != null ? e.max : null, unit: e.unit || null,
      default: secret ? null : String(RC.DEFAULTS[k]),
      recommendation: r.recommended ? { text: String(r.recommended), status: 'PROPOSED', reference: r.reference || null } : null,
      owner_role: r.owner_role ? { role: String(r.owner_role), status: 'PROPOSED' } : null,
      prerequisites: r.prerequisites || null,
      risk: RISKS.includes(e.risk) ? e.risk : 'medium',
      scopes: ['global'],
      change_role: 'super_admin',
      four_eyes: !!e.four_eyes && !secret,
      secret, editable: !secret,
      consumers: scannable(k) ? (_consumers.get(k) || []) : null,
    });
  }
  for (const p of GP.PARAMS) {
    if ((cat.excluded || {})[p.key]) continue;
    const e = (cat.keys || {})[p.key] || {};
    const r = regBy.get(p.key) || {};
    entries.push({
      key: p.key, source: 'governance_policy', category: e.category || null,
      title: humanize(p.key), description_en: p.en || null, description_fr: p.fr || null,
      type: p.type, allowed: p.type === 'enum' ? (p.values || []) : (p.type === 'bool' ? [true, false] : null),
      min: p.min != null ? p.min : null, max: p.max != null ? p.max : null, unit: e.unit || (/_hours$/.test(p.key) ? 'hours' : /_days$/.test(p.key) ? 'days' : null),
      default: p.default,
      recommendation: r.recommended ? { text: String(r.recommended), status: 'PROPOSED', reference: r.reference || null } : null,
      owner_role: r.owner_role ? { role: String(r.owner_role), status: 'PROPOSED' } : null,
      prerequisites: null,
      risk: RISKS.includes(e.risk) ? e.risk : (p.protected ? 'high' : 'medium'),
      scopes: p.siteScoped ? ['global', 'site'] : ['global'],
      change_role: 'super_admin',
      // the governance store's own two-person rule: relaxing a PROTECTED rule (and, when governance.dual_approval_tightening
      // is on, tightening one) becomes a proposal another super_admin decides — the center does not add a second layer
      four_eyes: !!p.protected, four_eyes_rule: p.protected ? 'governance_store' : null,
      protected: !!p.protected, stricter: p.stricter || null,
      secret: false, editable: true,
      consumers: _consumers.get(p.key) || [],
    });
  }
  for (const e of entries) if (e.source === 'report_config' && e.four_eyes) e.four_eyes_rule = 'away_from_default';
  // KPI RAG policies: listed for completeness, changed only through the KPI policy builder (adoption by kpi-committee).
  let kpi = [];
  try {
    const K = require('../public/lib/kpiRag.js');
    kpi = Object.keys(K.POLICIES || {}).sort().map((name) => ({ key: 'kpi_rag.' + name, source: 'kpi_rag', category: 'kpi', title: humanize(name),
      description_en: 'RAG policy used by KPI tiles (public/lib/kpiRag.js). Changed through the KPI policy builder, adopted by the KPI committee.',
      description_fr: 'Politique RAG des tuiles d\'indicateurs (public/lib/kpiRag.js). Se modifie dans le constructeur de politiques KPI, adoptée par le comité KPI.',
      type: 'json', default: K.POLICIES[name], recommendation: null, owner_role: { role: 'KPI committee', status: 'PROPOSED' }, risk: 'medium',
      scopes: ['global'], change_role: 'kpi-committee', four_eyes: true, four_eyes_rule: 'kpi_policy_builder', secret: false, editable: false,
      managed_by: 'kpi-builder.html', consumers: null }));
  } catch (_) { kpi = []; }
  _built = { categories: cat.categories || {}, entries, excluded: cat.excluded || {}, kpi_policies: kpi, by: new Map(entries.map((e) => [e.key, e])) };
  return _built;
}

/** Catalogue completeness against the code — used by the test and tools/agent/policy-catalogue.js --check. */
function coverage() {
  const RC = require('./reportConfig'); const GP = require('./governancePolicy');
  const cat = readJson(CATALOGUE_FILE, { keys: {}, excluded: {} });
  const missing = [...RC.KEYS, ...GP.PARAMS.map((p) => p.key)].filter((k) => !(cat.keys || {})[k] && !(cat.excluded || {})[k]);
  return { report_config: RC.KEYS.length, governance: GP.PARAMS.length, catalogued: Object.keys(cat.keys || {}).length, excluded: Object.keys(cat.excluded || {}).length, missing };
}

/**
 * Validate and normalise a value for a report_config entry. Returns the string to store; throws VALIDATION (400).
 * Governance policies are validated by their own store (GP.coerce) — not here.
 */
function validateConfigValue(entry, raw) {
  const bad = (m) => typed('VALIDATION', `${entry.key}: ${m}`, 400);
  if (!entry || entry.source !== 'report_config') throw bad('not a report_config rule');
  if (!entry.editable) throw bad('this value is a secret — set it in its own admin card; the policy center never reads or writes secrets');
  if (raw === undefined || raw === null) throw bad('a value is required');
  let v = typeof raw === 'boolean' ? (raw ? '1' : '0') : typeof raw === 'object' ? JSON.stringify(raw) : String(raw);
  v = v.trim();
  if (v.length > TEXT_MAX) throw bad(`at most ${TEXT_MAX} characters`);
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(v)) throw bad('control characters are not allowed');
  if (entry.allowed) { if (!entry.allowed.map(String).includes(v)) throw bad(`one of ${entry.allowed.map((a) => (a === '' ? "''" : a)).join(', ')}`); return v; }
  if (entry.type === 'number' || entry.type === 'number_or_empty' || (entry.min != null || entry.max != null)) {
    if (v === '' && (entry.type !== 'number' || String(entry.default) === '')) return v;   // empty = "off / not set" where the default is empty
    const n = Number(v);
    if (v === '' || !Number.isFinite(n)) throw bad('a number is expected');
    if (entry.min != null && n < entry.min) throw bad(`minimum ${entry.min}`);
    if (entry.max != null && n > entry.max) throw bad(`maximum ${entry.max}`);
    return v;
  }
  if (entry.type === 'json') {
    if (v === '' && String(entry.default) === '') return v;
    try { JSON.parse(v); } catch (_) { throw bad('valid JSON is expected'); }
    return v;
  }
  return v;
}

/** Does `next` need a second super_admin? report_config: a four-eyes key moving AWAY from its best-practice default. */
function needsSecondPerson(entry, current, next) {
  if (!entry || entry.source !== 'report_config' || !entry.four_eyes) return false;
  if (String(current) === String(next)) return false;
  return String(next) !== String(entry.default);
}

const deviates = (entry, value) => (entry.secret ? false : JSON.stringify(entry.default) !== JSON.stringify(entry.source === 'report_config' ? String(value) : value));

module.exports = { build, coverage, validateConfigValue, needsSecondPerson, deviates, describeFromSource, inferType, scanConsumers, CATALOGUE_FILE, RISKS };
