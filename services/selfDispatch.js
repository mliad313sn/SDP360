'use strict';
// P5 / B2 — call one of THIS server's own routes over loopback (127.0.0.1, the port the request came in on), carrying
// the caller's own session token and NO Origin header. Used by the Site Actions bulk update so every line goes through
// the existing per-item route — its RBAC, validation and audit — instead of re-implementing them. Never leaves the host.
const http = require('http');

function selfPost(req, path, body) {
  const token = require('./sessionAuth').sessionToken(req);
  if (!/^\/api\//.test(String(path))) return Promise.resolve({ status: 400, json: { error: 'internal path only' } });
  return new Promise((resolve) => {
    const data = JSON.stringify(body || {});
    const r = http.request({ host: '127.0.0.1', port: req.socket.localPort, path, method: 'POST', agent: false,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), 'x-report-token': token || '' } },
    (resp) => { let b = ''; resp.on('data', (c) => (b += c)); resp.on('end', () => { let j = null; try { j = JSON.parse(b); } catch (_) { j = null; } resolve({ status: resp.statusCode, json: j }); }); });
    r.on('error', (e) => resolve({ status: 502, json: { error: e.message } }));
    r.end(data);
  });
}

module.exports = { selfPost };
