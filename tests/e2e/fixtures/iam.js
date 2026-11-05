'use strict';
// C-23 — helpers for the IAM / secret-rotation journeys (i1-i7). Throwaway accounts are created through
// reports-db (the same path Admin ▸ Users uses) on the journey's own database; passwords are random per run.
// `api` calls the server FROM the browser page, with the session cookie the real login set — so every
// check goes through the same global /api gate and session re-validation a person's browser goes through.
const crypto = require('crypto');
const http = require('http');

const pw = () => 'E2e!' + crypto.randomBytes(9).toString('hex');
const day = (n = 0) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

async function person(app, key, roles, site, extra) {
  const siteId = site && typeof site === 'object' ? site.id : site;
  const u = { username: 'e2e_' + key, password: pw(), full_name: 'E2E ' + key };
  await app.rdb.createUser(Object.assign({ username: u.username, full_name: u.full_name, password: u.password, roles, site_id: siteId || null }, extra || {}));
  u.id = Number((await app.rdb.pgHandle().prepare('SELECT id FROM users WHERE username = ?').get(u.username)).id);
  u.token = (await app.rdb.login(u.username, u.password)).token;   // API seeding only; journeys log in through the page
  return u;
}

/** fetch from inside the page (same origin, session cookie). → { status, body } */
function api(page, method, path, body) {
  return page.evaluate(async ([m, p, b]) => {
    const r = await fetch(p, { method: m, credentials: 'same-origin', headers: b ? { 'content-type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined });
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (_) { j = { raw: t }; }
    return { status: r.status, body: j };
  }, [method, path, body || null]);
}

/** A raw request with no cookie at all (anonymous caller / server-to-server key). → { status, text } */
function raw(base, method, p, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(base + p);
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, agent: false, headers: headers || {} }, (res) => {
      let t = ''; res.setEncoding('utf8'); res.on('data', (c) => { t += c; }); res.on('end', () => resolve({ status: res.statusCode, text: t }));
    });
    req.on('error', reject); req.end();
  });
}

/** Answer every window.prompt / confirm of the page with the next value of `answers` (then accept empty). */
function answerDialogs(page, answers) {
  const q = answers.slice();
  page.on('dialog', (d) => d.accept(q.length ? q.shift() : '').catch(() => {}));
}

module.exports = { person, api, raw, day, answerDialogs };
