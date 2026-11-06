'use strict';
// E-A03 — static report of hand-written error answers: every `res.status(4xx|5xx).json(…)` in
// server.js, routes/ and services/ that does NOT go through services/httpError.fail(). For each call
// it reads the argument (balanced parentheses, strings skipped) and records whether the body carries
// an `error` field, and whether a 5xx echoes `e.message` / `err.message` (internal text to a client).
// Pure + read-only. Used by tests/error-shape.test.js (ratchet) and runnable by hand:
//   node tools/test/error-shape-scan.js            → summary
//   node tools/test/error-shape-scan.js --list     → every call site
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const DEFAULT_FILES = () => {
  const out = [path.join(ROOT, 'server.js')];
  for (const d of ['routes', 'services']) {
    const walk = (dir) => { for (const f of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, f.name); if (f.isDirectory()) walk(p); else if (f.name.endsWith('.js')) out.push(p); } };
    walk(path.join(ROOT, d));
  }
  return out;
};

// Return the text between the "(" at `open` and its matching ")" — strings and template literals skipped.
function balanced(src, open) {
  let depth = 0; let i = open; let q = null;
  for (; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return src.slice(open + 1, i); }
  }
  return src.slice(open + 1);
}

const CALL = /\bres\.status\(\s*([45]\d\d)\s*\)\s*\.json\(/g;
function scanSource(src, file = '<src>') {
  const out = [];
  let m;
  CALL.lastIndex = 0;
  while ((m = CALL.exec(src))) {
    const lineStart = src.lastIndexOf('\n', m.index) + 1;
    if (/^\s*(\/\/|\*|\/\*)/.test(src.slice(lineStart, m.index))) continue;   // a comment that quotes the bad pattern
    const open = m.index + m[0].length - 1;
    const arg = balanced(src, open).trim();
    const line = src.slice(0, m.index).split('\n').length;
    const status = Number(m[1]);
    const hasError = /(^|[{,\s])error\s*:/.test(arg) || /^\{\s*error\b/.test(arg) || /(^|[{,\s])error\s*[,}]/.test(arg);
    const leaksMessage = status >= 500 && /\b(e|err|error|ex)\.message\b/.test(arg);
    out.push({ file, line, status, hasError, leaksMessage, arg: arg.slice(0, 160) });
  }
  return out;
}

function scan(files = DEFAULT_FILES()) {
  const rows = [];
  for (const f of files) rows.push(...scanSource(fs.readFileSync(f, 'utf8'), path.relative(ROOT, f).split(path.sep).join('/')));
  return rows;
}

function summarise(rows) {
  return {
    total: rows.length,
    without_error_field: rows.filter((r) => !r.hasError).length,
    five_xx_leaking_message: rows.filter((r) => r.leaksMessage).length,
    by_status: rows.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {}),
  };
}

module.exports = { scan, scanSource, summarise, balanced };

if (require.main === module) {
  const rows = scan();
  if (process.argv.includes('--list')) for (const r of rows) console.log(`${r.file}:${r.line}  ${r.status}  ${r.hasError ? '' : 'NO-ERROR-FIELD '}${r.leaksMessage ? 'LEAKS-MESSAGE ' : ''}${r.arg}`);
  console.log(JSON.stringify(summarise(rows), null, 2));
}
