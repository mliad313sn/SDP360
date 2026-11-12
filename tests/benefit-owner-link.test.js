'use strict';
// E-P05 (audit P-05) — "My work" block of the benefits a person owns (services/myWork.js, pure): present only when the
// route passes the reader (switch on), null when the reader fails (never 0); static checks of the pages.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { buildMyWork } = require('../services/myWork');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const site = { site_id: 1, code: 'HGO', name: 'Hounde' };
const due = [{ id: 4, project_id: 9, project_key: 'W2-1', project_name: 'WAN', description: 'Fewer outages', review_date: '2026-10-01', realised_value: null, verified_at: null }];

test('without the reader (switch off) the response carries no owned_benefits key — today unchanged', async () => {
  const w = await buildMyWork({ user: { id: 5 }, sites: [site], asOf: '2026-11-06', readers: {} });
  assert.equal('owned_benefits' in w, false);
});

test('with the reader: count + items; a throwing reader → null (not measured), an empty list → 0', async () => {
  const w = await buildMyWork({ user: { id: 5 }, sites: [site], asOf: '2026-11-06', readers: { ownedBenefits: async (u) => (u.id === 5 ? due : []) } });
  assert.equal(w.owned_benefits.count, 1); assert.equal(w.owned_benefits.items[0].status, 'missing'); assert.equal(w.owned_benefits.items[0].overdue, true);
  assert.equal(w.owned_benefits.items[0].link, 'project.html?id=9#benefits');
  const bad = await buildMyWork({ user: { id: 5 }, sites: [site], asOf: '2026-11-06', readers: { ownedBenefits: async () => { throw new Error('db'); } } });
  assert.equal(bad.owned_benefits, null);
  const none = await buildMyWork({ user: { id: 5 }, sites: [], asOf: '2026-11-06', readers: { ownedBenefits: async () => [] } });
  assert.deepEqual(none.owned_benefits, { count: 0, items: [] }, 'a site-less person still sees their own benefits');
});

test('pages: the owner picker is hidden until the switch answers; "My work" renders the block only when present', () => {
  const pj = read('public/project.html');
  assert.match(pj, /id="b-owner-user-box" hidden/);
  assert.match(pj, /if \(FEAT\.benefit_owner_link\) linkOwners\(\)/);
  const hp = read('public/lib/home-page.js');
  assert.match(hp, /ob === undefined \? ''/);
  assert.match(read('routes/myWork.js'), /benefit_owner_link_enabled\) === '1'/);
});
