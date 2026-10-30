'use strict';
// G18 — one language preference for the whole application: every page that remembers a language reads the
// shared key 'sdp_lang' FIRST and writes it on change (the old page keys are still written for compatibility).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const PUB = path.join(__dirname, '..', 'public');
const files = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!/^(vendor|brand|tracker-icons|design-system|dashboard-preview)$/.test(e.name)) walk(p); } else if (/\.(html|js)$/.test(e.name)) files.push(p); } })(PUB);
const LANG_KEY = /localStorage\.(getItem|setItem)\(\s*(['"][a-z_]*lang[a-z0-9_]*['"]|LANG_KEY)\s*[,)]/g;

test('every language read goes through sdp_lang first and every language write also writes sdp_lang', () => {
  const bad = [];
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const line of src.split('\n')) {
      const ms = [...line.matchAll(LANG_KEY)].filter((m) => !/dict_lang|report_token/.test(m[2]));
      if (!ms.length) continue;
      if (/em_dict_lang/.test(line)) continue; // dictation language (speech model), not the UI language
      if (/stays the default/.test(line)) continue; // field app: French as a first-visit DEFAULT, not a choice (sdp_lang still wins)
      const reads = ms.filter((m) => m[1] === 'getItem' && !/'sdp_lang'|SHARED/.test(m[2]));
      const writes = ms.filter((m) => m[1] === 'setItem' && !/'sdp_lang'|SHARED/.test(m[2]));
      if (reads.length && !/getItem\((?:'sdp_lang'|SHARED)\)\s*\|\|/.test(line)) bad.push(`${path.relative(PUB, f)}: read without sdp_lang: ${line.trim().slice(0, 120)}`);
      if (writes.length && !/setItem\((?:'sdp_lang'|SHARED),/.test(line)) bad.push(`${path.relative(PUB, f)}: write without sdp_lang: ${line.trim().slice(0, 120)}`);
    }
  }
  assert.deepStrictEqual(bad, []);
});

test('the manual remembers the language and opens in it', () => {
  const src = fs.readFileSync(path.join(PUB, 'help.html'), 'utf8');
  assert.match(src, /localStorage\.setItem\('sdp_lang', lang\)/);
  assert.match(src, /localStorage\.getItem\('sdp_lang'\)/);
});

test('the shared translation layer reads and writes sdp_lang', () => {
  const src = fs.readFileSync(path.join(PUB, 'lib', 'i18nText.js'), 'utf8');
  assert.match(src, /const SHARED = 'sdp_lang'/);
  assert.match(src, /localStorage\.getItem\(SHARED\) \|\| localStorage\.getItem\(key\)/);
  assert.match(src, /localStorage\.setItem\(SHARED, lang\)/);
});
