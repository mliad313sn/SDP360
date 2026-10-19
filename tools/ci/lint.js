'use strict';
// Step 2 (SDP-DASH-2.0) — CI syntax gate, no dependency: every tracked .js file must parse, and
// every inline <script> of every public/*.html page must parse (a syntax error there blanks a
// page in production while every server test stays green). JSX (*.jsx, text/babel) and
// non-JS script blocks (JSON, text/html templates) are skipped.
//
//   node tools/ci/lint.js        exit 1 on the first-found errors (all listed)
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');

function trackedFiles() {
  try {
    return execSync('git ls-files', { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      .split(/\r?\n/).filter(Boolean);
  } catch (e) {
    console.error('git ls-files failed — run from a git checkout'); process.exit(2);
  }
}

function checkJs(src, file) {
  const code = src.replace(/^#!.*/, '');
  // Compile as a CommonJS function body (top-level return/require allowed), never run it.
  new vm.Script(`(function (exports, require, module, __filename, __dirname) {\n${code}\n})`, { filename: file });
}

const SKIP_TYPES = /^(text\/(babel|html|template|x-template)|application\/(ld\+)?json|importmap|module)$/i;

function inlineScripts(html) {
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1];
    if (/\bsrc\s*=/.test(attrs)) continue;
    const t = (attrs.match(/\btype\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (t && SKIP_TYPES.test(t)) continue;
    if (!m[2].trim()) continue;
    out.push({ code: m[2], line: html.slice(0, m.index).split('\n').length });
  }
  return out;
}

function main() {
  const files = trackedFiles();
  const errors = [];
  let jsCount = 0, scriptCount = 0;
  for (const f of files) {
    if (f.startsWith('node_modules/') || f.includes('/vendor/') || /\.min\.js$/.test(f)) continue;
    const abs = path.join(ROOT, f);
    if (!fs.existsSync(abs)) continue;
    if (f.endsWith('.js')) {
      jsCount++;
      try { checkJs(fs.readFileSync(abs, 'utf8'), f); }
      catch (e) { errors.push(`${f}: ${e.message}`); }
    } else if (f.startsWith('public/') && f.endsWith('.html')) {
      for (const s of inlineScripts(fs.readFileSync(abs, 'utf8'))) {
        scriptCount++;
        try { new vm.Script(s.code, { filename: `${f}:${s.line}` }); }
        catch (e) { errors.push(`${f} (inline script at line ${s.line}): ${e.message}`); }
      }
    }
  }
  if (errors.length) {
    console.error(`✗ ${errors.length} syntax error(s):`);
    errors.forEach(e => console.error('  ' + e));
    process.exit(1);
  }
  console.log(`✓ syntax OK — ${jsCount} JS file(s), ${scriptCount} inline page script(s)`);
}

if (require.main === module) main();
module.exports = { inlineScripts, checkJs };
