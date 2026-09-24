'use strict';
// Shared source-extraction helper for the static HTML tests (G-01, audit 2026-09-24).
//
// Slices one function's source out of a page so a test can assert on it. Two
// invariants, both load-bearing (see tests/fn-source.test.js):
//
//   1. LINE-ENDING AGNOSTIC. Git for Windows ships core.autocrlf=true in the SYSTEM
//      gitconfig, so a fresh checkout materialises public/*.html as CRLF while
//      `git status` stays clean. The original '\n}\n' probe returned -1 there and the
//      slice degraded to '' on every Windows machine.
//   2. NEVER returns an empty slice — it throws. An empty string makes every NEGATIVE
//      assertion (assert.ok(!code.includes(...))) pass vacuously, so the guarantees the
//      caller believes it is protecting quietly stop being checked.
//
// End detection: a top-level closing brace in column 0 first (the shape of every
// function in our inline page scripts); a brace-count scan as a fallback for one-liners
// and nested declarations. The fallback does not parse strings or comments — it is only
// reached when the column-0 probe found nothing.
function fnSource(src, name) {
  const text = String(src).replace(/\r\n/g, '\n');
  const asyncAt = text.indexOf(`async function ${name}(`);
  const start = asyncAt >= 0 ? asyncAt : text.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`fnSource: ${name} not found`);

  const flat = text.indexOf('\n}\n', start);
  if (flat >= 0) return text.slice(start, flat + 2);

  const open = text.indexOf('{', start);
  if (open >= 0) {
    let depth = 0;
    for (let i = open; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}' && --depth === 0) return text.slice(start, i + 1);
    }
  }
  throw new Error(`fnSource: ${name} — closing brace not found (unbalanced source?)`);
}

module.exports = { fnSource };
