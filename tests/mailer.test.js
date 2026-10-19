'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildMailer } = require('../services/mailer');

test('smtp transport composes to/cc/subject/attachments', async () => {
  const sent = [];
  const stub = { sendMail: async (msg) => { sent.push(msg); return { messageId: 'x' }; } };
  const mailer = buildMailer({ transport: 'smtp', from: 'it@edv-ops.com' }, { makeSmtp: () => stub });
  const r = await mailer.send({ to: 'a@x', cc: ['b@x'], subject: 'S', html: '<b>hi</b>', attachments: [{ filename: 'r.pdf', content: Buffer.from('%PDF') }] });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(sent[0].to, 'a@x');
  assert.deepStrictEqual(sent[0].cc, ['b@x']);
  assert.strictEqual(sent[0].from, 'it@edv-ops.com');
  assert.strictEqual(sent[0].attachments[0].filename, 'r.pdf');
});

test('send never throws — returns {ok:false,error} on transport failure', async () => {
  const stub = { sendMail: async () => { throw new Error('smtp down'); } };
  const mailer = buildMailer({ transport: 'smtp', from: 'it@edv-ops.com' }, { makeSmtp: () => stub });
  const r = await mailer.send({ to: 'a@x', subject: 'S', html: 'x' });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /smtp down/);
});

test('graph transport is stubbed → returns ok:false not-implemented', async () => {
  const mailer = buildMailer({ transport: 'graph' }, {});
  const r = await mailer.send({ to: 'a@x', subject: 'S', html: 'x' });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /graph.*not/i);
});
