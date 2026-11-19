'use strict';
// P01 — boot integrity. Every relative require() in the runtime code (everything tracked except tests/ and
// node_modules) must resolve to a file that is IN GIT. A module that exists only on one machine boots there
// and fails everywhere else, silently: server.js wraps some requires in try/catch and the dependent routes
// then answer 503.
//
// Two such modules are known missing at this baseline. They are NOT recreated here (the owner must supply
// them — they last existed at commit 8007aea^ on the unrelated branch claude/confident-pascal-03veex, see
// docs/agent-execution/BASELINE-*.md). This test pins the list: a NEW missing require fails, and so does a
// known-missing file that comes back without this list being cleaned.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

// file → the routes in server.js that answer 503 while it is absent.
const KNOWN_MISSING = {
  'generate-site-monthly-pptx.js': ['GET /api/reports/monthly/:site_id/:year/:month/site-template/pptx'],
  'executive-new-report.js': ['POST /api/executive-new-pptx'],
};

function trackedFiles() {
  try {
    return execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch (_) {
    return null;   // not a git checkout (installed copy) — the static scan below needs git
  }
}

// Drop comment lines (JSDoc "require('./x')" usage examples). Line-based on purpose: a regex comment
// stripper is fooled by strings such as '*/*' and can swallow real code. A require() written after code on
// a line with a trailing comment is still seen; one inside a comment-only line is not code.
function stripComments(src) {
  return src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
}

function missingRequires(tracked) {
  const set = new Set(tracked);
  const out = [];
  for (const f of tracked) {
    if (!f.endsWith('.js') || f.startsWith('tests/') || f.startsWith('node_modules/')) continue;
    const abs = path.join(ROOT, f);
    if (!fs.existsSync(abs)) continue;
    const src = stripComments(fs.readFileSync(abs, 'utf8'));
    for (const m of src.matchAll(/\brequire\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)) {
      const t = path.posix.normalize(path.posix.join(path.posix.dirname(f), m[1]));
      const candidates = [t, t + '.js', t + '.json', t + '/index.js'];
      if (!candidates.some((c) => set.has(c))) out.push({ from: f, target: t });
    }
  }
  return out;
}

test('every relative require() in runtime code resolves to a file tracked in git (except the pinned list)', (t) => {
  const tracked = trackedFiles();
  if (!tracked) { t.skip('not a git checkout'); return; }
  const missing = missingRequires(tracked);
  const unexpected = missing.filter((m) => !(m.target in KNOWN_MISSING));
  assert.deepStrictEqual(unexpected, [], 'require() of a file absent from git — commit it or remove the require');
  const stillMissing = new Set(missing.map((m) => m.target));
  for (const f of Object.keys(KNOWN_MISSING)) {
    assert.ok(stillMissing.has(f), `${f} is no longer a missing require — remove it from KNOWN_MISSING and from BASELINE`);
    assert.ok(!tracked.includes(f), `${f} is tracked again — remove it from KNOWN_MISSING`);
  }
});

test('each known-missing module is loaded in a guarded try/catch and its routes answer 503, not 500', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8').replace(/\r\n/g, '\n');
  for (const [file, routes] of Object.entries(KNOWN_MISSING)) {
    const at = src.indexOf(`require('./${file}')`);
    assert.ok(at > 0, `server.js no longer requires ./${file} — update KNOWN_MISSING`);
    const before = src.slice(Math.max(0, at - 200), at);
    assert.match(before, /try\s*\{[^}]*$/, `require('./${file}') must stay inside try { } (boot must survive)`);
    const holder = (before.match(/(\w+)\s*=\s*$/) || [])[1];
    assert.ok(holder, `cannot find the variable that holds ./${file}`);
    for (const r of routes) {
      const [method, p] = r.split(' ');
      const decl = `app.${method.toLowerCase()}('${p}'`;
      const ri = src.indexOf(decl);
      assert.ok(ri > 0, `route ${r} not found in server.js`);
      const body = src.slice(ri, ri + 600);
      assert.ok(body.includes(`if (!${holder}) return res.status(503)`), `${r} must answer 503 while ./${file} is absent`);
    }
  }
});
