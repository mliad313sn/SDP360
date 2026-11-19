'use strict';
// P09 — page rationalisation inventory. Reads docs/agent-execution/INVENTORY.json (generated) + the workspace profile
// catalogue + the French-coverage lists, and writes docs/agent-execution/P09-PAGE-INVENTORY.md. Owner profile and the
// overlap / proposal columns are AGENT (AI) PROPOSALS — nothing is merged or retired without the sponsor (D-P09-3).
// Usage: node tools/agent/p09-page-inventory.js [--check]
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const inv = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/agent-execution/INVENTORY.json'), 'utf8'));
const WP = require(path.join(ROOT, 'public/lib/workspaceProfiles.js'));
const i18n = fs.readFileSync(path.join(ROOT, 'tests/i18n-coverage.test.js'), 'utf8');

// page → profile ids whose destination list contains it
const byPage = {};
for (const p of WP.PROFILES) for (const d of p.destinations) {
  const href = (WP.DESTINATIONS[d] || {}).href; if (!href) continue;
  const f = href.split(/[?#]/)[0]; (byPage[f] = byPage[f] || new Set()).add(p.id);
}
// AI proposals: overlap + recommendation (keep | merge-into:X | retire | redirect-stub | reference)
const P = {
  'assets-finance.html': ['redirect stub → assets.html#finance', 'retire after one release of bookmark grace'],
  'assets-hygiene.html': ['redirect stub → assets.html#hygiene', 'retire after one release of bookmark grace'],
  'wan-health.html': ['redirect stub → wan.html', 'retire after one release of bookmark grace'],
  'wan-sla.html': ['redirect stub → wan.html', 'retire after one release of bookmark grace'],
  'executive.html': ['executive scorecard vs dashboards.html?key=exec-home vs it-review.html (three executive surfaces)', 'merge candidate: keep it-review + exec-home, fold scorecard tabs (needs C-09 page-usage data)'],
  'it-review.html': ['overlaps executive.html (same audience, same KPIs)', 'keep (faithful port the executive reads)'],
  'executive-report.html': ['deck builder; overlaps report-studio.html for generation', 'keep until report-studio covers the Group IT deck'],
  'report-studio.html': ['overlaps executive-report.html', 'keep'],
  'analytics.html': ['overlaps index.html (ticket trends) and dashboards.html', 'keep (analyst depth); review after usage data'],
  'meetings-compliance.html': ['5 Engagements also shown in meetings-insights.html heatmap', 'merge-into: meetings-insights.html (proposal)'],
  'meetings-progress.html': ['pre-brief also reachable from cockpit.html agenda', 'keep (deep-linked from meeting.html)'],
  'meetings-council.html': ['escalations also in meetings-issues.html (escalate filter)', 'merge-into: meetings-issues.html as a view (proposal)'],
  'meetings-unsigned.html': ['unsigned PVs also on home.html "awaiting me"', 'keep (bulk signing)'],
  'commitments.html': ['overlaps site-actions.html + handoffs.html (follow-up lists)', 'review: one "my follow-ups" page (proposal)'],
  'handoffs.html': ['overlaps commitments.html', 'review with commitments.html'],
  'obligations.html': ['governance obligations vs policies.html', 'keep'],
  'infra-health.html': ['overlaps wan.html (infra availability)', 'keep (LAN/WLAN/servers vs WAN)'],
  'trackers.html': ['business trackers vs activity-tracker.html (IT programme tracker)', 'keep both; label the difference'],
  'coverage.html': ['not reachable from any menu or link', 'reach or retire (proposal: link from help.html)'],
  'kpi-builder.html': ['not reachable; overlaps dashboard-composer.html', 'reach or retire'],
  'site-report.html': ['not reachable from nav (opened from e-mails / reports)', 'keep (printable, deep-linked)'],
  'itsm-roadmap.html': ['personal tool of the service manager (outside nav by design)', 'keep'],
  'itsm-integrations-plan.html': ['meeting document rendered as a page', 'move to docs (proposal)'],
  'exec-view.html': ['public SharePoint snapshot', 'keep'],
  'value-scoreboard.html': ['pilot measurement page', 'keep (pilot instrument)'],
  'data-quality.html': ['admin board, hidden by default; overlaps connector-health.html', 'merge candidate with connector-health.html'],
  'connector-health.html': ['overlaps data-quality.html', 'keep'],
  'dashboard-preview/index.html': ['design prototype', 'retire from prod package (dev only)'],
  'field/index.html': ['offline field app', 'keep'],
};
const UN = (i18n.match(/const UNTRANSLATED = \{([\s\S]*?)\n\};/) || [, ''])[1];
const SELF = (i18n.match(/const SELF_TRANSLATED = \[([\s\S]*?)\];/) || [, ''])[1];
const TR = (i18n.match(/const TRANSLATED_PAGES = \{([\s\S]*?)\n\};/) || [, ''])[1];
const fr = (f) => (TR.includes(`'${f}'`) ? 'translated' : SELF.includes(`'${f}'`) ? 'self-translated' : UN.includes(`'${f}'`) ? 'English (pending)' : '—');

const all = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.html$/.test(e.name)) all.push(path.relative(path.join(ROOT, 'public'), p).replace(/\\/g, '/')); } })(path.join(ROOT, 'public'));
all.sort();
const meta = Object.fromEntries(inv.pages.map((p) => [p.page.replace(/^public\//, ''), p]));
const L = ['# P09 — Page inventory and rationalisation proposals', '',
  '_Generated by `node tools/agent/p09-page-inventory.js` (`--check` fails when out of date). Owner profile, overlap and proposal',
  'columns are **AI proposals** — no page is merged or retired without the sponsor (decision D-P09-3)._', '',
  '**Last-30-day usage:** `routes/pageUsage.js` (`GET /api/ux/page-usage`, super_admin) aggregates `page_viewed` events',
  'from `system_log`. This qualification environment holds no production data, so **usage = unknown** for every page;',
  'the pilot runbook (S2) captures it on the pilot instance. A merge or retirement must wait for that data.', '',
  `Pages found: **${all.length}** HTML files under \`public/\` (${all.filter((f) => !f.includes('/')).length} top-level, ${all.filter((f) => f.startsWith('design-system/')).length} design-system specimens, others nested).`, '',
  '| Page | Roles required | In nav | Owner profile(s) | French | Usage 30 d | Overlap | Proposal |', '|---|---|---|---|---|---|---|---|'];
let ds = 0;
for (const f of all) {
  if (f.startsWith('design-system/')) { ds++; continue; }
  const m = meta[f] || {};
  const owners = byPage[f] ? [...byPage[f]].join(', ') : (m.requires ? '— (reached from ' + (m.parent || '?') + ')' : '—');
  const [ov, prop] = P[f] || ['', 'keep'];
  L.push(`| \`${f}\` | ${(m.requires || ['?']).join(', ')} | ${m.in_navigation ? 'yes' : 'no'} | ${owners} | ${fr(f)} | unknown | ${ov} | ${prop} |`);
}
L.push(`| \`design-system/*.html\` (${ds} files) | public | no | — (brand reference) | n/a | unknown | brand specimens | keep as reference; exclude from the prod package (proposal) |`);
L.push('', '## Summary of proposals (none executed)', '',
  '- **Retire after a bookmark grace period:** the 4 redirect stubs (assets-finance, assets-hygiene, wan-health, wan-sla).',
  '- **Merge candidates (need usage data first):** executive.html into exec-home + it-review; meetings-compliance into meetings-insights; meetings-council as a view of meetings-issues; data-quality with connector-health; commitments + handoffs as one follow-up page.',
  '- **Reach or retire:** coverage.html, kpi-builder.html (no entry point).',
  '- **Move out of the served app:** itsm-integrations-plan.html (a document), dashboard-preview/, design-system/ (reference only).', '');
const out = L.join('\n');
const target = path.join(ROOT, 'docs/agent-execution/P09-PAGE-INVENTORY.md');
if (process.argv.includes('--check')) { const cur = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : ''; if (cur !== out) { console.error('P09-PAGE-INVENTORY.md is out of date'); process.exit(1); } console.log('up to date'); }
else { fs.writeFileSync(target, out); console.log('wrote', path.relative(ROOT, target), all.length, 'pages'); }
