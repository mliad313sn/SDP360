'use strict';
// Teams SLA alerts — read-only SDP Cloud API v3 client. Zoho OAuth (refresh token →
// access token, cached) + paginated open-requests listing. Transport injected: no network.
const test = require('node:test');
const assert = require('node:assert');
const { makeSdpClient } = require('../services/sdpApiClient');

const CFG = { baseUrl: 'https://sdp.example/app/itdesk/api/v3', accountsUrl: 'https://accounts.zoho.com',
  clientId: 'cid', clientSecret: 'csec', refreshToken: 'rtok' };

function fakeTransport(pages, { tokenFail } = {}) {
  const calls = [];
  return {
    calls,
    post: async (url, body, opts) => {
      calls.push({ m: 'post', url, opts });
      if (tokenFail) return { data: { error: 'invalid_client' } };
      return { data: { access_token: 'AT' + calls.filter(c => c.m === 'post').length, expires_in: 3600 } };
    },
    get: async (url, opts) => {
      calls.push({ m: 'get', url, opts });
      const input = JSON.parse(opts.params.input_data);
      const page = Math.floor((input.list_info.start_index - 1) / input.list_info.row_count);
      return { data: { requests: pages[page] || [], list_info: { has_more_rows: page < pages.length - 1 } } };
    },
  };
}

test('unconfigured → inert: no call, empty list', async () => {
  const t = fakeTransport([[{ id: 1 }]]);
  const c = makeSdpClient({ ...CFG, refreshToken: '' , transport: t });
  assert.equal(c.configured, false);
  assert.deepEqual(await c.listOpenRequests(), []);
  assert.equal(t.calls.length, 0);
});

test('refreshes a token, sends it with the v3 Accept header, walks every page', async () => {
  const t = fakeTransport([[{ id: 1 }, { id: 2 }], [{ id: 3 }]]);
  const c = makeSdpClient({ ...CFG, transport: t });
  const rows = await c.listOpenRequests({ rowCount: 2 });
  assert.deepEqual(rows.map(r => r.id), [1, 2, 3]);
  const post = t.calls.find(x => x.m === 'post');
  assert.equal(post.url, 'https://accounts.zoho.com/oauth/v2/token');
  assert.deepEqual(post.opts.params, { refresh_token: 'rtok', client_id: 'cid', client_secret: 'csec', grant_type: 'refresh_token' });
  const get = t.calls.find(x => x.m === 'get');
  assert.equal(get.url, 'https://sdp.example/app/itdesk/api/v3/requests');
  assert.equal(get.opts.headers.Authorization, 'Zoho-oauthtoken AT1');
  assert.equal(get.opts.headers.Accept, 'application/vnd.manageengine.sdp.v3+json');
  const li = JSON.parse(get.opts.params.input_data).list_info;
  assert.equal(li.filter_by.name, 'Open_System');
  assert.ok(li.fields_required.includes('first_response_due_by_time'));
});

test('the access token is cached between calls', async () => {
  const t = fakeTransport([[{ id: 1 }]]);
  const c = makeSdpClient({ ...CFG, transport: t });
  await c.listOpenRequests(); await c.listOpenRequests();
  assert.equal(t.calls.filter(x => x.m === 'post').length, 1);
});

test('a refused token surfaces a readable error, never the secret', async () => {
  const c = makeSdpClient({ ...CFG, transport: fakeTransport([], { tokenFail: true }) });
  await assert.rejects(() => c.listOpenRequests(), (e) => /invalid_client/.test(e.message) && !/csec|rtok/.test(e.message));
});

test('pagination is bounded (maxPages) so a runaway API cannot loop forever', async () => {
  const pages = Array.from({ length: 50 }, (_, i) => [{ id: i }]);
  const c = makeSdpClient({ ...CFG, transport: fakeTransport(pages) });
  const rows = await c.listOpenRequests({ rowCount: 1, maxPages: 5 });
  assert.equal(rows.length, 5);
});

test('the filter name is configurable', async () => {
  const t = fakeTransport([[]]);
  await makeSdpClient({ ...CFG, transport: t, openFilter: 'Open_Requests' }).listOpenRequests();
  assert.equal(JSON.parse(t.calls.find(x => x.m === 'get').opts.params.input_data).list_info.filter_by.name, 'Open_Requests');
});
