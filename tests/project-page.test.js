'use strict';
// A-14 — the project record page (public/project.html), the "Convert to project" action on rfi.html and the task
// kind + project links on portfolio.html: static checks. They cannot prove rendering — that is the browser check.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { fnSource } = require('./_fn-source');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const page = read('public/project.html');
const script = page.slice(page.lastIndexOf('<script nonce='));

test('project.html is in the _htmlCache list and served by sendHtmlPage before express.static', () => {
  const src = read('server.js');
  const cacheLine = src.split('\n').find((l) => l.includes("'cockpit.html'") && l.includes("'portfolio.html'") && !l.includes('app.get'));
  assert.ok(cacheLine && cacheLine.includes("'project.html'"), 'project.html in the boot-load list');
  const loop = src.split('\n').find((l) => /for \(const _p of \[/.test(l) && l.includes("'portfolio.html'"));
  assert.ok(loop && loop.includes("'project.html'") && loop.includes('sendHtmlPage'), 'project.html routed through sendHtmlPage');
  assert.ok(src.indexOf(loop) < src.indexOf("app.use(express.static(path.join(__dirname, 'public')"), 'before express.static');
});

test('project.html reads the id from URLSearchParams before anything else', () => {
  const body = script.slice(script.indexOf('"use strict";') + '"use strict";'.length);
  const firstStatement = body.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('//'))[0];
  assert.match(firstStatement, /^var PID = new URLSearchParams\(window\.location\.search\)\.get\("id"\);$/);
});

const RENDERERS = ['renderOverview', 'renderCharter', 'renderPlan', 'ganttSvg', 'renderMilestones', 'renderRaid', 'renderBenefits', 'renderGates', 'renderHistory'];
test('every dynamic value of project.html goes through escapeHtml (no raw concatenation of an API field)', () => {
  assert.match(script, /esc = R\.escapeHtml/);
  for (const name of RENDERERS) {
    const src = fnSource(script, name);
    // a string literal directly glued to a property access (x.y, not a call) means an unescaped value
    const raw = [...src.matchAll(/["']\s*\+\s*([A-Za-z_$][\w$]*(?:\.[\w$]+)+)(?!\s*\(|[\w$.])/g)].map((m) => m[1]);
    assert.deepEqual(raw, [], `${name} concatenates raw values: ${raw.join(', ')}`);
    const rawRight = [...src.matchAll(/(?<![\w$.(])([A-Za-z_$][\w$]*(?:\.[\w$]+)+)\s*\+\s*["']/g)].map((m) => m[1]);
    assert.deepEqual(rawRight, [], `${name} concatenates raw values: ${rawRight.join(', ')}`);
  }
});

test('Gantt bars carry an aria-label and critical tasks carry a text marker besides colour', () => {
  const g = fnSource(script, 'ganttSvg');
  assert.match(g, /role=\\"img\\" aria-label=\\""\s*\+\s*esc\(label\)/, 'each bar group is labelled');
  assert.match(g, /<title>/, 'tooltip with slack');
  assert.match(g, /crit \? " CP" : ""/, 'CP in the row label');
  assert.match(g, />CP<\/text>/, 'CP glyph next to the bar');
  assert.match(g, /critical" : "slack "/, 'label says critical or the slack');
  assert.match(g, /duration unknown — counted as 1 day/, 'assumed duration is named, never shown as measured');
  assert.match(g, /today/, 'today line');
  assert.match(g, /stroke-dasharray/, 'baseline ghost');
});

test('History tab handles HTTP 403 with a restricted message distinct from an empty history', () => {
  const h = fnSource(script, 'loadHistory');
  assert.match(h, /e\.status === 403/);
  assert.match(h, /History is restricted to the committee, the admin tier and the finance role/);
  assert.match(fnSource(script, 'renderHistory'), /No recorded event yet/);
  assert.ok(!/No recorded event/.test(h), 'the 403 branch never says "no history"');
});

test('project.html wires its handlers in JS (no inline on…= attributes) and uses role=tablist with keyboard arrows', () => {
  assert.ok(!/\son[a-z]+="/i.test(page));
  assert.match(page, /role="tablist"/);
  assert.equal((page.match(/role="tab"/g) || []).length, 8);
  assert.match(script, /ArrowRight/); assert.match(script, /ArrowLeft/);
  assert.match(script, /\/api\/governance\/portfolio\/project\//);
});

test('rfi.html exposes the convert action only when committee is true and calls /api/governance/rfi/:id/to-project', () => {
  const r = read('public/rfi.html');
  assert.match(r, /committee && \["accepted", "scheduled"\]\.indexOf\(r\.status\) >= 0/);
  assert.match(r, /data-convert=/);
  assert.match(r, /\/api\/governance\/rfi\/" \+ [\w.]+ \+ "\/to-project"/);
  assert.match(r, /project\.html\?id=/);
  assert.match(r, /project_id/, 'a 409 with project_id links to the existing project');
});

test('portfolio.html edit form offers the task kind and links project keys to project.html?id=', () => {
  const p = read('public/portfolio.html');
  assert.match(p, /ALL_KINDS = \[[^\]]*"task"/);
  assert.match(p, /PLAN_KINDS = \[[^\]]*"task"/);
  assert.match(p, /project\.html\?id=/);
  for (const id of ['e-wbs', 'e-tparent', 'e-dur', 'e-alloc', 'e-effort', 'e-deps']) assert.match(p, new RegExp(`id="${id}"`), id);
});

test('help §25 describes the project page in EN and FR, inside the section container', () => {
  const h = read('public/help.html');
  for (const [id, title] of [['en-25', 'Project page'], ['fr-25', 'Page projet']]) {
    const start = h.indexOf(`<div class="section" id="${id}">`); assert.ok(start > 0, id);
    const end = h.indexOf('<div class="section"', start + 10);
    assert.ok(h.slice(start, end).includes(`<li><strong>${title}</strong>`), `${title} inside #${id}`);
  }
});
