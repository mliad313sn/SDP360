'use strict';
// M4 — outbound URL guard (services/safeUrl.js). DNS is injected: no test touches the resolver.
const { test } = require('node:test');
const assert = require('node:assert');
const S = require('../services/safeUrl');

const pub = async (host) => [{ address: '203.0.113.10', family: 4 }];   // a public (TEST-NET-3) answer
const resolving = (ip) => async () => [{ address: ip, family: ip.includes(':') ? 6 : 4 }];
const refused = async (p, re) => {
  try { await p; assert.fail('expected UNSAFE_URL'); }
  catch (e) { assert.equal(e.code, 'UNSAFE_URL', e.message); if (re) assert.match(e.message, re); }
};

test('https is required (http, ftp, javascript are refused before any DNS)', async () => {
  for (const u of ['http://hooks.example.com/x', 'ftp://hooks.example.com/x', 'javascript:alert(1)', 'not a url', '']) {
    await refused(S.validateOutboundUrl(u, { lookup: () => { throw new Error('lookup must not run'); } }));
  }
});

test('a public host accepted with the injected lookup, URL normalised', async () => {
  const out = await S.validateOutboundUrl('HTTPS://Hooks.Example.COM:443/a/../b?x=1', { lookup: pub });
  assert.equal(out, 'https://hooks.example.com/b?x=1');
});

test('loopback 127.0.0.0/8 and localhost are refused (literal and resolved)', async () => {
  await refused(S.validateOutboundUrl('https://127.0.0.1/hook'), /loopback|private/);
  await refused(S.validateOutboundUrl('https://127.8.9.10/hook'));
  await refused(S.validateOutboundUrl('https://localhost/hook'), /local/);
  await refused(S.validateOutboundUrl('https://evil.example.com/hook', { lookup: resolving('127.0.0.1') }), /resolves to 127\.0\.0\.1/);
});

test('RFC1918 10/8 is refused', async () => {
  await refused(S.validateOutboundUrl('https://10.0.0.5/hook'));
  await refused(S.validateOutboundUrl('https://a.example.com/hook', { lookup: resolving('10.255.255.254') }));
});

test('RFC1918 172.16/12 is refused — and 172.32.x is public', async () => {
  await refused(S.validateOutboundUrl('https://172.16.0.1/hook'));
  await refused(S.validateOutboundUrl('https://172.31.255.254/hook'));
  assert.equal(await S.validateOutboundUrl('https://172.32.0.1/hook'), 'https://172.32.0.1/hook');
});

test('RFC1918 192.168/16 is refused', async () => {
  await refused(S.validateOutboundUrl('https://192.168.1.10:8443/api'));
  await refused(S.validateOutboundUrl('https://opm.example.com/api', { lookup: resolving('192.168.1.10') }));
});

test('link-local 169.254/16 and the cloud metadata address are refused', async () => {
  await refused(S.validateOutboundUrl('https://169.254.169.254/latest/meta-data'), /metadata|link-local/);
  await refused(S.validateOutboundUrl('https://169.254.1.1/x'));
  await refused(S.validateOutboundUrl('https://metadata.google.internal/computeMetadata/v1/'), /metadata/);
  await refused(S.validateOutboundUrl('https://m.example.com/x', { lookup: resolving('169.254.169.254') }));
});

test('IPv6 loopback, link-local, unique-local (incl. fd00:ec2::254) and IPv4-mapped forms are refused', async () => {
  for (const ip of ['::1', 'fe80::1', 'fc00::1', 'fd00:ec2::254', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:7f00:1', '::']) {
    await refused(S.validateOutboundUrl(`https://[${ip}]/hook`), undefined);
    assert.equal(S.isPrivateAddress(ip), true, ip);
  }
  await refused(S.validateOutboundUrl('https://v6.example.com/hook', { lookup: resolving('fe80::abcd') }));
  assert.equal(S.isPrivateAddress('2606:4700::1111'), false);
});

test('a host on the allow list (exact or *.suffix) bypasses the DNS gate after the https check', async () => {
  const lookup = () => { throw new Error('DNS must not be consulted for an allow-listed host'); };
  const allow = ['*.webhook.office.com', 'opm.internal.corp'];
  assert.equal(await S.validateOutboundUrl('https://prod-01.westeurope.webhook.office.com/webhookb2/abc', { allowHosts: allow, lookup }),
    'https://prod-01.westeurope.webhook.office.com/webhookb2/abc');
  assert.equal(await S.validateOutboundUrl('https://opm.internal.corp:8061/api', { allowHosts: allow, lookup }), 'https://opm.internal.corp:8061/api');
  // https is still required for an allow-listed host, and the bare suffix itself does not match `*.`
  await refused(S.validateOutboundUrl('http://prod-01.webhook.office.com/x', { allowHosts: allow, lookup }), /https/);
  assert.equal(S.hostAllowed('webhook.office.com', allow), false);
  assert.equal(S.hostAllowed('evilwebhook.office.com', allow), false);
});

test('an unresolvable host is refused, a mixed answer with one private address is refused', async () => {
  await refused(S.validateOutboundUrl('https://nope.example.com/x', { lookup: async () => { const e = new Error('x'); e.code = 'ENOTFOUND'; throw e; } }), /could not be resolved/);
  await refused(S.validateOutboundUrl('https://nope.example.com/x', { lookup: async () => [] }));
  await refused(S.validateOutboundUrl('https://mixed.example.com/x', { lookup: async () => [{ address: '203.0.113.5' }, { address: '10.1.1.1' }] }), /10\.1\.1\.1/);
});

test('credentials in the URL are refused; allow-list parsing + config defaults', async () => {
  await assert.rejects(S.validateOutboundUrl('https://user:pw@hooks.example.com/x', { lookup: pub }), /Credentials/);
  assert.deepEqual(S.parseAllowHosts(' A.Example.com, *.B.example ;c.example  a.example.com'), ['a.example.com', '*.b.example', 'c.example']);
  assert.deepEqual(S.allowHostsFromConfig({ outbound_allow_hosts: 'opm.corp' }), [...S.DEFAULT_ALLOW_HOSTS, 'opm.corp']);
  assert.deepEqual(S.allowHostsFromConfig({}), S.DEFAULT_ALLOW_HOSTS);
  const rc = require('../services/reportConfig');
  assert.equal(rc.DEFAULTS.outbound_allow_hosts, '', 'outbound_allow_hosts must be in DEFAULTS or setConfig drops it');
});

test('redactUrl keeps scheme+host only; axiosSafeOptions disables redirects', () => {
  assert.equal(S.redactUrl('https://prod.webhook.office.com/webhookb2/SECRET-PATH?sig=xyz'), 'https://prod.webhook.office.com');
  assert.equal(S.redactUrl('https://h.example:8443/a'), 'https://h.example:8443');
  assert.equal(S.redactUrl('garbage'), '<invalid url>');
  assert.deepEqual(S.axiosSafeOptions(), { maxRedirects: 0 });
});

test('safePost / safeGet refuse an unsafe URL with code UNSAFE_URL and never call the network', async () => {
  for (const fn of [S.safePost(['*.webhook.office.com']), S.safeGet([])]) {
    try { await fn('https://10.0.0.9/hook', {}); assert.fail('expected refusal'); }
    catch (e) { assert.equal(e.code, 'UNSAFE_URL'); }
  }
});
