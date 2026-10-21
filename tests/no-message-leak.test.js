'use strict';
// M9 — non-regression grep: no route may echo a caught exception's message to the client.
// Every `(e|err|error).message` that sits inside a response expression (`res.status(…)`,
// `res.json(…)`, `.json({ error: …`) in server.js and routes/*.js must be on the explicit
// allow-list below (deliberate 4xx validation messages). A new leak = a new line = this test fails.
// routes/extApi.js is generic since M7 and is scanned too (it must stay at zero).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const FILES = ['server.js', ...fs.readdirSync(path.join(ROOT, 'routes')).filter(f => f.endsWith('.js')).map(f => 'routes/' + f)];
// `.message` INSIDE the argument of a `.json(…)` call (one level of nested parentheses tolerated).
// A constant body next to a `console.error(e.message)` on the same line is not a leak.
const LEAK = /\.json\((?:[^()]|\([^()]*\))*\b(e|err|error)\.message\b/;

// Deliberate, reviewed: these 4xx bodies carry a validation message meant for the user
// (MissingColumnError names the absent CSV column; the Teams SLA card refuses an unsafe URL and says why).
const ALLOWED = [
  'server.js :: if (e instanceof MissingColumnError) return res.status(400).json({ error: e.message, column: e.column, source: e.source });',
  "routes/teamsSla.js :: catch (e) { return res.status(400).json({ error: `${k}: ${e.message}` }); }",
  "routes/teamsSla.js :: catch (e) { return res.status(400).json({ error: `Webhook URL for ${group}: ${e.message}` }); }",
  "routes/teamsSla.js :: if (e && e.code === safeUrl.UNSAFE) return res.status(400).json({ error: `Webhook URL refused: ${e.message}` });",
];

// Frozen budget for the RAW token count in server.js (the fiche's acceptance figure). The
// remaining occurrences are `console.*` log lines — lower this number as they get cleaned, never raise it.
const SERVER_RAW_BUDGET = 125;

function leakLines() {
  const out = [];
  for (const f of FILES) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n').split('\n');
    src.forEach((line) => {
      if (!LEAK.test(line)) return;
      out.push(`${f} :: ${line.trim()}`);
    });
  }
  return out;
}

test('every e.message inside a response expression is on the reviewed allow-list', () => {
  const found = leakLines();
  const unexpected = found.filter(l => !ALLOWED.includes(l));
  assert.deepEqual(unexpected, [], 'new message leak(s) — route the error through services/httpError.fail(res, e) instead');
  const gone = ALLOWED.filter(l => !found.includes(l));
  assert.deepEqual(gone, [], 'an allow-listed line disappeared — remove it from ALLOWED so the list stays exact');
});

test(`server.js raw "e.message" count stays within the frozen budget (${SERVER_RAW_BUDGET})`, () => {
  const n = (fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8').match(/e\.message/g) || []).length;
  assert.ok(n <= SERVER_RAW_BUDGET, `server.js has ${n} occurrences of "e.message", budget ${SERVER_RAW_BUDGET}`);
});

test('no 5xx body is built from a caught message anywhere (status(5xx).json with *.message)', () => {
  const bad = [];
  for (const f of FILES) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
    const re = /res\.status\((5\d\d|[a-zA-Z_.?|]+\|\|5\d\d)\)\.json\([^\n]*\.message/g;
    let m; while ((m = re.exec(src))) bad.push(`${f} :: ${m[0].slice(0, 120)}`);
  }
  assert.deepEqual(bad, []);
});

test('the final Express error handler is mounted in server.js after the last route', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const at = src.indexOf("app.use(require('./services/httpError').errorHandler)");
  assert.ok(at > 0, 'errorHandler is mounted');
  const startAt = src.indexOf('async function start()');
  const lastRoute = Math.max(...['app.use(require(', 'app.get(', 'app.post(', 'app.put(', 'app.delete('].map(k => src.lastIndexOf(k, startAt)));
  assert.ok(at >= lastRoute, 'errorHandler is the LAST app.use before start()');
});
