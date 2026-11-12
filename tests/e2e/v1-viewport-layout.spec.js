'use strict';
// C-24 (G32) — the key pages at 1440 / 1024 / 768 / 390 px (F-UX-04: + 320 px = WCAG 1.4.10 reflow width,
// + the coordinator pages): no horizontal page scroll, the shell header
// visible and inside the viewport, header and content not overlapping, no box escaping the viewport
// outside a scroll container, and no console error / uncaught page error.
// Structural assertions only (fixtures/layout.js) — the viewport screenshots are written to the artefact
// folder for a PERSON to look at; they are never compared or auto-approved.
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { runJourney } = require('./fixtures/harness');
const { artifactDir, classify } = require('./fixtures/browser');
const layout = require('./fixtures/layout');

const WIDTHS = [1440, 1024, 768, 390, 320];
const PAGES = ['index', 'dashboards', 'analytics', 'assets', 'wan', 'cockpit', 'site-actions', 'access',
  // F-UX-04 — the pages a site coordinator lives in
  'home', 'reports', 'meetings', 'meeting', 'inspection', 'inspections', 'site-awareness', 'field/index'];
// Pages without the shared shell (the field PWA has its own header): the header checks do not apply.
const NO_SHELL = new Set(['field/index']);
// F-UX-04 — known reflow problems as of the day the matrix was widened: "page@width" → reason. The list may only
// SHRINK (tests/reflow-known.test.js pins its size). A problem not listed fails the journey; a listed entry that
// no longer fails also fails it (remove it from the list). Screenshots are for a person; nothing is auto-approved.
// Routes that answer 404 by design while their switch is off (the page hides the panel on a 404).
const EXPECTED_404 = ['/api/inspection/repeat-findings'];   // insp_repeat_findings = '0'
const KNOWN = require('./fixtures/reflow-known.json').known;

// A handful of recent tickets so the Helpdesk page renders its charts and tables (an empty page hides the
// layouts that overflow). Without them the outcome depended on a stray data/raw_cache.json in the checkout:
// the 768 px overflow on index (2026-11-05) only showed where such a file existed.
function tickets() {
  const now = Date.now(), iso = (h) => new Date(now - h * 3600e3).toISOString();
  const groups = ['Hounde IT Agents', 'Mana IT Agents', 'Sabodala IT Agents with a long group name'];
  return Array.from({ length: 9 }, (_, i) => ({
    request_id: 'E2E-V1-' + i, display_id: String(900000 + i), subject: 'E2E viewport ticket ' + i,
    request_status: i % 3 === 0 ? 'Closed' : 'Open', pending_status: i % 3 === 0 ? 0 : 1, overdue_status: i % 4 === 0 ? 1 : 0,
    request_type: 'Incident', template: null, service_request: 0, is_escalated: 0, reopen_count: 0, due_by_time: null,
    time_elapsed_ms: null, created_time: iso(24 + i * 30), resolved_time: i % 3 === 0 ? iso(i * 30) : null,
    completed_time: i % 3 === 0 ? iso(i * 30) : null, responded_time: iso(23 + i * 30), assigned_time: iso(23 + i * 30),
    last_updated_time: iso(i), first_response_overdue: 'false', technician: 'E2E tech ' + (i % 2), requester: null,
    category: ['Network', 'Hardware', 'Email'][i % 3], sub_category: null, site: ['HOUNDE', 'MANA', 'Sabodala'][i % 3],
    tech_group: groups[i % 3], mode: 'Web Form', impact: null,
  }));
}

runJourney('V1 viewport matrix key pages layout and console', async ({ app, base, world, browser, j, login }) => {
  await app.rdb.upsertRequestBatch(tickets());
  const shots = path.join(artifactDir(), 'viewports');
  fs.mkdirSync(shots, { recursive: true });
  const problems = [];
  for (const w of WIDTHS) {
    const ctx = await j.newContext(browser, { viewport: { width: w, height: 900 } });
    const page = await ctx.newPage();
    let errs = [];
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const loc = (m.location() && m.location().url) || '';
      // a blocked request to an allow-listed origin (fonts, ADR-B05) is reported by the harness, not here
      // F-UX-04 — a 404 that IS the documented "switch off" answer is not a console defect
      if (/status of 404/.test(m.text()) && EXPECTED_404.some((u) => loc.includes(u))) return;
      if (/ERR_BLOCKED_BY_CLIENT/.test(m.text()) && j.rec.external.unexpected.length === 0 && (classify(loc) !== 'unexpected')) return;
      errs.push(m.text().slice(0, 200));
    });
    page.on('pageerror', (e) => errs.push('uncaught: ' + String(e && e.message || e).slice(0, 200)));
    await login(page, world.users.sa, '/home.html');
    for (const p of PAGES) {
      errs = [];
      await page.goto(base + '/' + p + '.html');
      await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
      assert.strictEqual(new URL(page.url()).pathname, '/' + p + '.html', p + ' at ' + w + ' px was redirected to ' + page.url());
      const m = await page.evaluate(layout.measure);
      const bad = layout.judge(m, { shell: !NO_SHELL.has(p) });
      if (errs.length) bad.push('console errors: ' + errs.join(' | '));
      const key = `${p}@${w}`;
      if (bad.length && !KNOWN[key]) problems.push(`${p} @${w}px: ${bad.join('; ')}`);
      if (!bad.length && KNOWN[key]) problems.push(`${key} is listed in fixtures/reflow-known.json but now passes — remove it`);
      if (w === 1440) await j.measure(page, p);
      await page.screenshot({ path: path.join(shots, `${p.replace('/', '-')}-${w}.png`) }).catch(() => {});
    }
    await ctx.close();
  }
  // one line per failing page × width, in the assertion MESSAGE (the runner's TAP filter drops YAML diffs)
  assert.ok(problems.length === 0, 'V1 layout / console problems (' + problems.length + '):\n  ' + problems.join('\n  '));
}, { timeout: 1200000 });
