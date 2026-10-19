'use strict';
// 2026-10-07 — the Teams SLA alerts are documented in the help, in both languages: what is
// sent, how to create a channel webhook in Teams Workflows, how to connect it in the
// dashboard, and the phone-notification setting. Drift guard, not prose review.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs'), path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'help.html'), 'utf8').replace(/\r\n/g, '\n');
const SUBS = 4;

for (const lang of ['en', 'fr']) {
  test(`[${lang}] section 19 and its sub-sections exist and are in the table of contents`, () => {
    assert.ok(src.includes(`id="${lang}-19"`), `section ${lang}-19 exists`);
    assert.ok(src.includes(`href="#${lang}-19"`), 'linked from the table of contents');
    for (let i = 1; i <= SUBS; i++) {
      assert.ok(src.includes(`id="${lang}-19-${i}"`), `sub-section ${lang}-19-${i}`);
      assert.ok(src.includes(`href="#${lang}-19-${i}"`), `sub-section ${lang}-19-${i} in the table of contents`);
    }
  });

  test(`[${lang}] the section 19 entries sit INSIDE the table-of-contents container`, () => {
    const tocStarts = [...src.matchAll(/<div class="toc">/g)].map(m => m.index);
    assert.strictEqual(tocStarts.length, 2, 'one table of contents per language');
    const start = tocStarts[lang === 'en' ? 0 : 1];
    const close = src.indexOf('\n    </div>', start);
    const link = src.indexOf(`href="#${lang}-19"`);
    assert.ok(link > start && link < close, 'the link is inside the TOC div, not after it');
  });

  test(`[${lang}] the section sits inside the content of its language`, () => {
    const sec = src.indexOf(`id="${lang}-19"`);
    const end = src.indexOf(`<!-- /sec-${lang} -->`);
    const contentEnd = src.lastIndexOf('</div><!-- /content -->', end);
    assert.ok(sec > 0 && sec < contentEnd, 'before the end of the content column');
  });
}

test('the key facts are stated', () => {
  const s = src.slice(src.indexOf('id="en-19"'));
  assert.match(s, /webhook/i);
  assert.match(s, /5 min/);
  assert.ok(/secret/i.test(s), 'the webhook URL is a secret');
  assert.ok(/Show in Activity and banner/.test(s), 'the phone-notification setting is explained');
});
