'use strict';
// G2-PLATFORM — Express 5 / body-parser 2 leave req.body undefined on a body-less request;
// services/bodyDefault restores the Express 4 `{}` so handlers that destructure req.body
// answer instead of throwing a 500. A real JSON body is still parsed (the parser wins).
const { test } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const express = require('express');
const fetch = require('./_http-fetch');
const bodyDefault = require('../services/bodyDefault');

async function serve(app) {
  const s = await new Promise((r) => { const x = http.createServer(app).listen(0, '127.0.0.1', () => r(x)); });
  return { base: `http://127.0.0.1:${s.address().port}`, close: () => s.close() };
}
function appWith(mw) {
  const app = express();
  app.use(...mw, express.json());
  app.post('/x', (req, res) => { const { a } = req.body; res.json({ a: a === undefined ? null : a }); });
  app.use((err, req, res, next) => res.status(500).json({ error: String(err && err.message) }));   // eslint-disable-line no-unused-vars
  return app;
}

test('a body-less POST reaches the handler with {} (no 500)', async () => {
  const { base, close } = await serve(appWith([bodyDefault]));
  try {
    const r = await fetch(base + '/x', { method: 'POST' });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { a: null });
  } finally { close(); }
});

test('a JSON body is still parsed after the default', async () => {
  const { base, close } = await serve(appWith([bodyDefault]));
  try {
    const r = await fetch(base + '/x', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ a: 7 }) });
    assert.deepEqual(await r.json(), { a: 7 });
  } finally { close(); }
});

test('the server wires bodyDefault in front of the global JSON parser', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(src, /app\.use\(require\('\.\/services\/bodyDefault'\), express\.json\(\)\)/);
});
