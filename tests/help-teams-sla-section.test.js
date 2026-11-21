'use strict';
// 2026-10-07 — the Teams SLA alerts are documented in the help, in both languages: what is sent, how to create a
// channel webhook in Teams Workflows, how to connect it in the dashboard, and the phone-notification setting.
// 2026-11-21: the numbered section 19 became the stable anchor #teams-sla with four named sub-sections.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs'), path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'help.html'), 'utf8').replace(/\r\n/g, '\n');
const SUBS = ['teams-sla-what', 'teams-sla-webhook', 'teams-sla-connect', 'teams-sla-phone'];

test('the Teams SLA section and its sub-sections exist, in both languages', () => {
  assert.ok(src.includes('<section class="hsec" id="teams-sla">'));
  for (const id of SUBS) {
    const a = src.indexOf(`id="${id}"`); assert.ok(a > 0, id);
    const sub = src.slice(a, src.indexOf('</div>\n  </div>', a));
    assert.ok(sub.includes('data-lng="en"') && sub.includes('data-lng="fr"'), `${id} in both languages`);
  }
});

test('the section is linked from INSIDE the table of contents and sits inside the main content', () => {
  const start = src.indexOf('<nav class="help-toc"'), end = src.indexOf('</nav>', start);
  const link = src.indexOf('href="#teams-sla"');
  assert.ok(link > start && link < end);
  const sec = src.indexOf('id="teams-sla"');
  assert.ok(sec > src.indexOf('<main id="main"') && sec < src.indexOf('</main>'));
});

test('the key facts are stated', () => {
  const s = src.slice(src.indexOf('id="teams-sla"'), src.indexOf('id="security"'));
  assert.match(s, /webhook/i);
  assert.match(s, /5 min/);
  assert.ok(/secret/i.test(s), 'the webhook URL is a secret');
  assert.ok(/Show in Activity and banner/.test(s), 'the phone-notification setting is explained');
});
