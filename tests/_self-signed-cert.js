'use strict';
// Test helper — a self-signed X.509 certificate for a loopback https stand-in, built with Node's
// crypto only (no openssl on the path, nothing committed: a private key in the repo would be a
// gitleaks hit even as a fixture). Returns PEM { key, cert } usable as https.createServer options
// AND as a `ca` bundle on the client side (the certificate is its own issuer).
//
// Minimal DER encoder — exactly the fields a v3 RSA-SHA256 certificate with a SAN needs.
const crypto = require('crypto');

function len(n) {
  if (n < 0x80) return Buffer.from([n]);
  const bytes = []; while (n > 0) { bytes.unshift(n & 0xff); n >>= 8; }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
const tlv = (tag, body) => Buffer.concat([Buffer.from([tag]), len(body.length), body]);
const seq = (...parts) => tlv(0x30, Buffer.concat(parts));
const set = (...parts) => tlv(0x31, Buffer.concat(parts));
const int = (n) => { let b = Buffer.isBuffer(n) ? n : Buffer.from([n]); if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]); return tlv(0x02, b); };
const nul = () => Buffer.from([0x05, 0x00]);
const utf8 = (s) => tlv(0x0c, Buffer.from(s, 'utf8'));
const octets = (b) => tlv(0x04, b);
const bitstr = (b) => tlv(0x03, Buffer.concat([Buffer.from([0]), b]));
const bool = (v) => tlv(0x01, Buffer.from([v ? 0xff : 0]));
const explicit = (n, body) => tlv(0xa0 | n, body);
function oid(s) {
  const p = s.split('.').map(Number);
  const out = [p[0] * 40 + p[1]];
  for (const v of p.slice(2)) { const b = []; let x = v; do { b.unshift(x & 0x7f); x >>= 7; } while (x > 0); for (let i = 0; i < b.length - 1; i++) b[i] |= 0x80; out.push(...b); }
  return tlv(0x06, Buffer.from(out));
}
function utcTime(d) {
  const p = (n) => String(n).padStart(2, '0');
  return tlv(0x17, Buffer.from(`${p(d.getUTCFullYear() % 100)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`));
}
const pem = (label, der) => `-----BEGIN ${label}-----\n${der.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END ${label}-----\n`;

/**
 * @param {{cn?: string, ip?: string, dns?: string, days?: number}} [o]
 * @returns {{key: string, cert: string}} PEM strings
 */
function selfSignedCert({ cn = '127.0.0.1', ip = '127.0.0.1', dns = 'localhost', days = 2 } = {}) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const sha256WithRsa = seq(oid('1.2.840.113549.1.1.11'), nul());
  const name = seq(set(seq(oid('2.5.4.3'), utf8(cn))));
  const now = new Date(Date.now() - 60 * 1000);
  const validity = seq(utcTime(now), utcTime(new Date(now.getTime() + days * 86400000)));
  const sanBody = Buffer.concat([
    tlv(0x82, Buffer.from(dns, 'ascii')),                                      // [2] dNSName
    tlv(0x87, Buffer.from(ip.split('.').map(Number))),                          // [7] iPAddress
  ]);
  const exts = explicit(3, seq(
    seq(oid('2.5.29.17'), octets(seq(sanBody))),                                 // subjectAltName
    seq(oid('2.5.29.19'), bool(true), octets(seq(bool(true)))),                  // basicConstraints CA:TRUE (critical) → usable as its own CA
    seq(oid('2.5.29.15'), bool(true), octets(bitstr(Buffer.from([0xa4])))),      // keyUsage: digitalSignature, keyEncipherment, keyCertSign
  ));
  const serial = crypto.randomBytes(8); serial[0] &= 0x7f;
  const tbs = seq(explicit(0, int(2)), int(serial), sha256WithRsa, name, validity, name, spki, exts);
  const sig = crypto.sign('sha256', tbs, privateKey);
  const cert = seq(tbs, sha256WithRsa, bitstr(sig));
  return { key: privateKey.export({ type: 'pkcs8', format: 'pem' }), cert: pem('CERTIFICATE', cert) };
}

module.exports = { selfSignedCert };
