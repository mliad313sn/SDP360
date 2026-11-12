'use strict';
// UAT-OI-07 (G1-SYNC) — test-only guard: the SERVER process of a browser journey may not open a connection to
// any host but loopback (and the test database host). The browser side is already blocked by
// tests/e2e/fixtures/browser.js; this closes the server side (Zoho token refresh / Analytics, Meraki, OpManager,
// SDP API, SMTP, webhooks) at the lowest common layer — net.Socket.prototype.connect — so http, https, axios,
// fetch (undici), tls and raw net all go through it.
//
// A refused attempt never reaches the network: the socket is destroyed right after (setImmediate) with
// E2E_OUTBOUND_BLOCKED (callers see an ordinary connection error), and the attempt is RECORDED so the journey
// artefact lists it as an unexpected external call (tests/e2e/fixtures/harness.js asserts the list is empty).
// Never loaded by the application.
const net = require('net');

const LOOPBACK = ['localhost', '127.0.0.1', '::1', '::ffff:127.0.0.1'];
const PROXY_VARS = ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy'];
let state = null;

function normHost(h) { return String(h == null || h === '' ? 'localhost' : h).trim().toLowerCase().replace(/^\[|\]$/g, ''); }

/** { host, port } of a Socket#connect call, or null for a local (unix socket / named pipe) path. */
function target(args) {
  let a = args[0];
  if (Array.isArray(a)) a = a[0];                                   // net.createConnection → normalised [options, cb]
  if (a && typeof a === 'object') {
    if (a.path) return null;
    return { host: normHost(a.host || a.hostname), port: a.port == null ? null : Number(a.port) };
  }
  if (typeof a === 'number' || (typeof a === 'string' && /^\d+$/.test(a))) return { host: normHost(typeof args[1] === 'string' ? args[1] : 'localhost'), port: Number(a) };
  return null;                                                       // a string path = local socket
}

function caller() {
  const lines = String(new Error().stack || '').split('\n').slice(2);
  const own = lines.find((l) => /\((?!node:)[^)]*\)$|at (?!node:)\//.test(l) && !/outboundGuard\.js/.test(l) && !/node_modules/.test(l));
  return own ? own.trim().replace(/^at /, '').slice(0, 200) : null;
}

/**
 * Install once per process. allowHosts adds hosts beyond loopback (e.g. the PostgreSQL host of PG_URL).
 * @returns {{ attempts: () => object[], reset: () => void, uninstall: () => void, allowed: string[] }}
 */
function install({ allowHosts = [] } = {}) {
  if (state) { for (const h of allowHosts) state.allowed.add(normHost(h)); return state.api; }
  const allowed = new Set([...LOOPBACK, ...allowHosts.map(normHost)]);
  const attempts = [];
  // A loopback forward proxy (HTTPS_PROXY=http://127.0.0.1:…, common on CI and dev boxes) would carry an external
  // call through an ALLOWED connection: axios / follow-redirects honour these variables. Drop them for the process.
  const proxyEnv = {};
  for (const k of PROXY_VARS) if (k in process.env) { proxyEnv[k] = process.env[k]; delete process.env[k]; }
  const orig = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function guardedConnect(...args) {
    const t = target(args);
    if (t && !allowed.has(t.host)) {
      attempts.push({ host: t.host, port: t.port, at: new Date().toISOString(), from: caller() });
      const err = new Error(`e2e outbound guard: connection to ${t.host}:${t.port} refused — the server may not call external hosts during a journey`);
      err.code = 'E2E_OUTBOUND_BLOCKED';
      // setImmediate, not nextTick: http.ClientRequest attaches its socket 'error' listener on a nextTick of its own
      setImmediate(() => { if (this.listenerCount('error') > 0) this.destroy(err); else this.destroy(); });
      return this;
    }
    return orig.apply(this, args);
  };
  const api = {
    attempts: () => attempts.map((x) => ({ ...x })),
    reset: () => { attempts.length = 0; },
    uninstall: () => { net.Socket.prototype.connect = orig; Object.assign(process.env, proxyEnv); state = null; },
    get allowed() { return [...allowed]; },
  };
  state = { allowed, api };
  return api;
}

/** The PostgreSQL host(s) named in a connection URL (allowed: the journey's own database). */
function dbHosts(url) {
  try { const u = new URL(url); return u.hostname ? [u.hostname] : []; } catch (_) { return []; }
}

module.exports = { install, target, dbHosts, LOOPBACK, PROXY_VARS };
