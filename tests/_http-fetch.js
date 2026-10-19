'use strict';
// fetch-shaped shim over core `http` for the route-smoke suites.
//
// WHY: the global `fetch` is undici, whose keep-alive sockets/pool trip a libuv assertion
// (`!(handle->flags & UV_HANDLE_CLOSING)`, src/win/async.c) when `--test-force-exit` tears the
// process down on Windows — the subtests all pass, then the FILE is marked failed. Core http
// with `agent: false` opens one short-lived socket per request and exits cleanly.
//
// Surface: status · ok · headers.get(name) · text() · json() · arrayBuffer() — the subset the
// suites use. Usage (top of a smoke file): `const fetch = require('./_http-fetch');`
const http = require('http');

function fetch(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname + u.search,
      method: opts.method || 'GET', headers: opts.headers || {}, agent: false,
    }, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({
          status: res.statusCode,
          ok: res.statusCode >= 200 && res.statusCode < 300,
          headers: { get: (k) => { const v = res.headers[String(k).toLowerCase()]; return v == null ? null : (Array.isArray(v) ? v.join(', ') : v); } },
          text: async () => buf.toString('utf8'),
          json: async () => JSON.parse(buf.toString('utf8')),
          arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        });
      });
    });
    req.on('error', reject);
    if (opts.body != null) req.write(opts.body);
    req.end();
  });
}

module.exports = fetch;
