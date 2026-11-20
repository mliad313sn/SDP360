'use strict';
// Adoption Lot B (items 11, 16, 22) — group card on Home for a person with no site, data-source freshness strip for
// the admin tier, Helpdesk opening on the person's own site. All behind switches defaulting to '0'. Unknown → "—",
// never 0 / green; every figure is the server's (the helpers only order and label).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const HG = require('../public/lib/homeGroup');
const HSD = require('../public/lib/helpdeskSiteDefault');
const SA = require('../public/lib/siteAliases');
const ROOT = path.join(__dirname, '..');
const HIER = ['viewer', 'editor', 'admin', 'executive', 'super_admin'];
const has = (roles) => (r) => roles.includes(r) || (HIER.includes(r) && roles.some((x) => HIER.indexOf(x) >= HIER.indexOf(r)));

test('blocks: nothing while the switches are off, whatever the role', () => {
  for (const roles of [['viewer'], ['admin'], ['executive'], ['super_admin'], ['committee-member']]) {
    assert.deepStrictEqual(HG.blocksFor(has(roles), {}, true), { group: false, worst: false, freshness: false });
    assert.deepStrictEqual(HG.blocksFor(has(roles), { home_group_variant: '0', home_freshness_strip: '0' }, true), { group: false, worst: false, freshness: false });
  }
});

test('blocks: group card only without a site; worst sites only for the roles the fleet route serves; freshness admin tier', () => {
  const on = { home_group_variant: '1', home_freshness_strip: '1' };
  assert.deepStrictEqual(HG.blocksFor(has(['committee-member']), on, true), { group: true, worst: false, freshness: false });
  assert.deepStrictEqual(HG.blocksFor(has(['finance-viewer']), on, true), { group: true, worst: false, freshness: false });
  assert.deepStrictEqual(HG.blocksFor(has(['executive']), on, true), { group: true, worst: true, freshness: true });
  assert.deepStrictEqual(HG.blocksFor(has(['admin']), on, true), { group: true, worst: false, freshness: true });
  assert.deepStrictEqual(HG.blocksFor(has(['editor']), on, false), { group: false, worst: false, freshness: false }, 'a person with sites keeps the site cards');
});

test('worst sites: red before amber, green / na never listed, null when nothing is measured', () => {
  assert.strictEqual(HG.worstSites(null), null);
  assert.strictEqual(HG.worstSites({ sites: [{ site_id: 1, overall_rag: 'na', cells: {} }] }), null, 'all na = not measured, never "no alert"');
  const fleet = { sites: [
    { site_id: 1, site_name: 'Mana', overall_rag: 'amber', cells: { a: { rag: 'amber' } } },
    { site_id: 2, site_name: 'Houndé', overall_rag: 'red', cells: { a: { rag: 'red' } } },
    { site_id: 3, site_name: 'Ity', overall_rag: 'red', cells: { a: { rag: 'red' }, b: { rag: 'red' } } },
    { site_id: 4, site_name: 'Lafigué', overall_rag: 'green', cells: {} },
    { site_id: 5, site_name: 'Sabodala', overall_rag: 'amber', cells: {} },
  ] };
  const w = HG.worstSites(fleet, 3);
  assert.strictEqual(w.total, 4);
  assert.deepStrictEqual(w.items.map((s) => s.name), ['Ity', 'Houndé', 'Mana']);
  assert.deepStrictEqual(HG.worstSites({ sites: [{ site_id: 4, overall_rag: 'green', cells: {} }] }), { total: 0, measured: 1, unmeasured: 0, items: [] });
});

test('late projects and decisions use the server flags; a missing answer is not measured', () => {
  assert.strictEqual(HG.lateProjects(null), null);
  assert.strictEqual(HG.lateProjects({}), null);
  const lp = HG.lateProjects({ gantt: [{ id: 1, key: 'P1', name: 'A', late: true, slip_days: null }, { id: 2, key: 'P2', name: 'B', late: false, slip_days: 4 }, { id: 3, name: 'C', late: false, slip_days: 0 }, { id: 4, name: 'D', late: false, slip_days: null }] });
  assert.strictEqual(lp.total, 2);
  assert.strictEqual(HG.decisions(null), null);
  assert.strictEqual(HG.decisions({ decisions_open: 'x' }), null);
  assert.deepStrictEqual(HG.decisions({ decisions_open: 3, decisions_overdue: 1 }), { open: 3, overdue: 1 });
});

test('group card: unknown reads "— non mesuré", never 0; no worst-sites line when the role cannot read the fleet', () => {
  const html = HG.groupHtml({ late: null, decisions: null }, 'fr');
  assert.match(html, /non mesuré/);
  assert.doesNotMatch(html, />0</);
  assert.doesNotMatch(html, /site-awareness\.html/, 'no link to a page the person cannot open');
  const withWorst = HG.groupHtml({ worst: { total: 1, items: [{ name: '<b>x</b>', rag: 'red' }] }, late: { total: 0, items: [] }, decisions: { open: 2, overdue: 0 } }, 'fr');
  assert.match(withWorst, /site-awareness\.html/);
  assert.match(withWorst, /&lt;b&gt;x&lt;\/b&gt;/, 'site names are escaped');
  assert.match(withWorst, /aucun projet en retard/);
});

test('freshness strip: a source never collected says so in amber; no answer = not measured', () => {
  const html = HG.freshnessHtml({ connectors: [{ id: 'sdp', name: 'SDP Analytics', state: 'ok', last_success: '2026-11-19T04:30:00Z' }, { id: 'meraki', name: 'Meraki', state: 'not_configured', last_success: null }] }, 'fr');
  assert.match(html, /2026-11-19 04:30/);
  assert.match(html, /hm-fresh-never">jamais synchronisé/);
  assert.match(html, /non configurée/);
  assert.match(HG.freshnessHtml(null, 'en'), /not measured/);
});

test('compose: calls only the routes of the blocks the person gets', async () => {
  const seen = [];
  const fetchJson = async (url) => { seen.push(url); return { status: 200, json: url.includes('portfolio') ? { gantt: [] } : url.includes('overview') ? { decisions_open: 0, decisions_overdue: 0 } : url.includes('fleet') ? { sites: [] } : { connectors: [] } }; };
  await HG.compose({ has: has(['committee-member']), policy: { home_group_variant: '1', home_freshness_strip: '1' }, noSite: true, fetchJson });
  assert.deepStrictEqual(seen.sort(), ['/api/governance/overview', '/api/governance/portfolio']);
  seen.length = 0;
  const off = await HG.compose({ has: has(['super_admin']), policy: {}, noSite: true, fetchJson });
  assert.deepStrictEqual(seen, [], 'switches off: no call at all');
  assert.deepStrictEqual(off, { group: '', fresh: '' });
  const failing = await HG.compose({ has: has(['executive']), policy: { home_group_variant: '1' }, noSite: true, fetchJson: async () => ({ status: 403, json: null }) });
  assert.match(failing.group, /not measured/);
});

test('helpdesk site default: own site through the alias fold, never for the admin tier, nothing on no match', () => {
  const opts = ['all', 'ABIDJAN', 'HOUNDE', 'Hounde Mine', 'MANA'];
  assert.strictEqual(HSD.pickOption(opts, ['Hounde'], SA.siteFoldKey), 'HOUNDE');
  assert.strictEqual(HSD.pickOption(opts, ['Houndé'], SA.siteFoldKey), 'HOUNDE');
  assert.strictEqual(HSD.pickOption(opts, ['Tanda'], SA.siteFoldKey), null);
  assert.strictEqual(HSD.pickOption(opts, ['Tanda', 'Mana'], SA.siteFoldKey), 'MANA', 'first site that matches');
  const pol = { helpdesk_site_default: '1' };
  assert.strictEqual(HSD.applies(pol, { site_id: 3 }, has(['editor'])), true);
  assert.strictEqual(HSD.applies(pol, { site_id: 3 }, has(['admin'])), false);
  assert.strictEqual(HSD.applies(pol, { site_id: null }, has(['viewer'])), false);
  assert.strictEqual(HSD.applies({}, { site_id: 3 }, has(['viewer'])), false, 'off by default');
});

test('pages load the Lot B helpers and call them only behind the switches', () => {
  const home = fs.readFileSync(path.join(ROOT, 'public', 'home.html'), 'utf8');
  assert.ok(home.indexOf('src="lib/homeGroup.js"') > 0 && home.indexOf('src="lib/homeGroup.js"') < home.indexOf('src="lib/home-page.js"'));
  const hp = fs.readFileSync(path.join(ROOT, 'public', 'lib', 'home-page.js'), 'utf8');
  assert.match(hp, /home_group_variant !== '1' && pol\.home_freshness_strip !== '1'/);
  const idx = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  assert.ok(idx.indexOf('src="lib/helpdeskSiteDefault.js"') > idx.indexOf('src="lib/siteAliases.js"'));
  assert.match(idx, /HelpdeskSiteDefault\.apply\(sEl,applyFilters\)/);
  const login = fs.readFileSync(path.join(ROOT, 'public', 'login.html'), 'utf8');
  assert.ok(login.indexOf('src="lib/workspaceProfiles.js"') > login.indexOf('src="lib/landing.js"'));
});
