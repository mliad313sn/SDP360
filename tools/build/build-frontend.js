'use strict';
// Step 5 — build step for the React front-ends (no more in-browser Babel). esbuild transpiles
// JSX ahead of time into public/<app>/dist/*.js (IIFE, React from the global UMD). Run:
//   node tools/build/build-frontend.js            (writes dist)
//   node tools/build/build-frontend.js --check    (fails when dist is stale — CI gate)
const path = require('path'), fs = require('fs'), crypto = require('crypto');
const esbuild = require('esbuild');
const ROOT = path.join(__dirname, '..', '..');
const APPS = [
  { entry: 'public/activity-tracker/App.jsx', out: 'public/activity-tracker/dist/app.js' },
];
function build({ write = true } = {}) {
  const results = [];
  for (const a of APPS) {
    const r = esbuild.buildSync({
      entryPoints: [path.join(ROOT, a.entry)], bundle: false, write: false, format: 'iife', target: ['es2019'],
      jsx: 'transform', jsxFactory: 'React.createElement', jsxFragment: 'React.Fragment', legalComments: 'none', minify: false,
      banner: { js: '/* built by tools/build/build-frontend.js — do not edit; edit ' + a.entry + ' */' },
    });
    const code = r.outputFiles[0].text;
    const outPath = path.join(ROOT, a.out);
    const sha = crypto.createHash('sha256').update(code).digest('hex').slice(0, 12);
    const current = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : null;
    const fresh = current === code;
    if (write && !fresh) { fs.mkdirSync(path.dirname(outPath), { recursive: true }); fs.writeFileSync(outPath, code); }
    results.push({ entry: a.entry, out: a.out, bytes: code.length, sha, fresh });
  }
  return results;
}
module.exports = { build, APPS };
if (require.main === module) {
  const check = process.argv.includes('--check');
  const res = build({ write: !check });
  for (const r of res) console.log(`${check ? (r.fresh ? 'fresh ' : 'STALE ') : 'built '} ${r.out}  ${r.bytes} bytes  ${r.sha}`);
  if (check && res.some((r) => !r.fresh)) { console.error('dist is stale — run: node tools/build/build-frontend.js'); process.exit(1); }
}
