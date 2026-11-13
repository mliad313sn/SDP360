'use strict';
// P9 / goal B7 — the export policy matrix, generated from services/exportPolicy.CATALOGUE:
// every catalogued export × every persona × {default, strict} → allow / mask / deny, checked against the rules
// the catalogue declares (not a hand-copied table, so a new row is covered the day it is added).
const { test } = require('node:test');
const assert = require('node:assert');
const XP = require('../services/exportPolicy');
const W = require('../services/exportWatermark');

const H = ['super_admin', 'executive', 'admin', 'editor', 'viewer'];
const hasRole = (u, r) => { const roles = u.roles || []; if (roles.includes(r)) return true; const need = H.indexOf(r); return need >= 0 && roles.some((x) => H.indexOf(x) >= 0 && H.indexOf(x) <= need); };
const PERSONAS = {
  business: { username: 'biz', roles: ['site-business'] },
  viewer: { username: 'v', roles: ['viewer'] },
  editor: { username: 'e', roles: ['editor'] },
  finance: { username: 'f', roles: ['viewer', 'finance-viewer'] },
  committee: { username: 'c', roles: ['viewer', 'committee-member'] },
  admin: { username: 'a', roles: ['admin'] },
  executive: { username: 'x', roles: ['executive'] },
  super_admin: { username: 's', roles: ['super_admin'] },
};
const moneyRole = (u) => hasRole(u, 'admin') || hasRole(u, 'finance-viewer');

test('catalogue rows are well-formed', () => {
  const ids = Object.keys(XP.CATALOGUE);
  assert.ok(ids.length >= 40, `catalogue too small (${ids.length})`);
  for (const id of ids) {
    const e = XP.CATALOGUE[id];
    assert.ok(e.module && Array.isArray(e.formats) && e.formats.length, id);
    assert.ok(['none', 'gated', 'masked'].includes(e.amounts), id);
    assert.ok(typeof e.today === 'string' && e.today.length, `${id}: today's guard documented`);
    if (e.strict) assert.ok(['editor', 'admin'].includes(e.strict.minTier) && e.strict.why, id);
  }
  // the 9 modules of the goal are all present
  const mods = new Set(ids.map((i) => XP.CATALOGUE[i].module));
  for (const m of ['meetings', 'inspection', 'reports', 'assets', 'governance', 'tracker', 'wan_sla', 'risk_register', 'finance']) assert.ok(mods.has(m), m);
});

for (const id of Object.keys(XP.CATALOGUE)) {
  const e = XP.CATALOGUE[id];
  test(`matrix ${id} (${e.formats.join('/')}) — role × default/strict`, () => {
    for (const [name, u] of Object.entries(PERSONAS)) {
      const def = XP.decide(u, id, { strict: false, hasRole });
      const st = XP.decide(u, id, { strict: true, hasRole });
      if (name === 'business') { assert.equal(def.decision, 'deny'); assert.equal(st.decision, 'deny'); continue; }
      // DEFAULT reproduces today: the policy never denies anyone the route guard let through
      assert.notEqual(def.decision, 'deny', `${id}/${name}: default must not deny`);
      // default amount rule = today's (committee exception only on legacyMoney rows)
      const todayMoney = moneyRole(u) || (e.legacyMoney === 'committee' && hasRole(u, 'committee-member'));
      assert.equal(def.money, todayMoney, `${id}/${name} default money`);
      // STRICT: amounts only for admin tier + finance-viewer, everywhere
      if (st.decision !== 'deny') assert.equal(st.money, moneyRole(u), `${id}/${name} strict money`);
      if (e.amounts === 'masked') {
        assert.equal(st.decision === 'deny' ? 'deny' : (moneyRole(u) ? 'allow' : 'mask'), st.decision, `${id}/${name} strict mask`);
      } else if (st.decision !== 'deny') assert.equal(st.decision, 'allow');
      // STRICT deny only where the PROPOSED row says so
      const tierOk = !e.strict || hasRole(u, e.strict.minTier) || (e.strict.orRoles || []).some((r) => hasRole(u, r));
      assert.equal(st.decision === 'deny', !tierOk, `${id}/${name} strict deny`);
    }
  });
}

test('the PROPOSED strict rows close the listed incoherences', () => {
  const v = PERSONAS.viewer, ed = PERSONAS.editor;
  for (const id of ['meetings.pv_pptx', 'reports.site_actions', 'meetings.progress_pptx']) {
    assert.equal(XP.decide(v, id, { hasRole }).decision, 'allow', `${id}: viewer allowed today`);
    assert.equal(XP.decide(v, id, { strict: true, hasRole }).decision, 'deny', `${id}: viewer refused strict`);
    assert.equal(XP.decide(ed, id, { strict: true, hasRole }).decision, 'allow', `${id}: editor kept`);
  }
  assert.equal(XP.decide(ed, 'risk_register.xlsx', { strict: true, hasRole }).decision, 'deny');
  assert.equal(XP.decide(PERSONAS.committee, 'governance.portfolio_deck', { hasRole }).decision, 'allow', 'committee sees amounts today');
  assert.equal(XP.decide(PERSONAS.committee, 'governance.portfolio_deck', { strict: true, hasRole }).decision, 'mask');
});

test('no session → deny; uncatalogued id → gate() refuses to build', () => {
  assert.equal(XP.decide(null, 'meetings.table', { hasRole }).decision, 'deny');
  assert.throws(() => XP.gate('nope.unknown'), /uncatalogued/);
});

test('row counts: csv lines, json arrays, tagged buffers, unknown = null', () => {
  assert.equal(XP._rowsOf('a,b\r\n1,2\r\n3,4\r\n', 'csv'), 2);
  assert.equal(XP._rowsOf('[1,2,3]', 'json'), 3);
  const b = Buffer.from('x'); Object.defineProperty(b, 'exportRows', { value: 7 });
  assert.equal(XP._rowsOf(b, 'xlsx'), 7);
  assert.equal(XP._rowsOf(Buffer.from('x'), 'pptx'), null, 'unknown is null, never 0');
  const tb = require('../services/tableExcel').buildWorkbook([{ name: 'A', rows: [{ a: 1 }, { a: 2 }] }, { name: 'B', rows: [{ b: 1 }] }]);
  assert.equal(tb.exportRows, 3);
});

test('watermark: csv / html / xlsx / pptx stamped, pdf untouched, failure returns the original', async () => {
  const wm = 'Export · alice · 2026-11-13T10:00:00.000Z';
  const csv = await W.apply('a,b\r\n1,2', 'text/csv', wm);
  assert.ok(csv.endsWith('"# Export · alice · 2026-11-13T10:00:00.000Z"\r\n'));
  assert.ok(!/^"?=/.test(csv.split('\r\n').pop()));
  const html = await W.apply('<html><body><p>x</p></body></html>', 'text/html', wm);
  assert.ok(/alice[^<]*<\/p><\/body>/.test(html));
  const XLSX = require('xlsx');
  const x = await W.apply(require('../services/tableExcel').buildWorkbook([{ name: 'Data', rows: [{ a: 1 }] }]), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', wm);
  const wb = XLSX.read(x, { type: 'buffer' });
  assert.equal(wb.SheetNames[0], 'Export'); assert.equal(wb.Sheets.Export.A1.v, wm); assert.ok(wb.SheetNames.includes('Data'));
  const PptxGenJS = require('pptxgenjs'); const p = new PptxGenJS(); p.addSlide().addText('hi', { x: 1, y: 1, w: 2, h: 1 });
  const pbuf = await p.write({ outputType: 'nodebuffer' });
  const out = await W.apply(pbuf, 'application/vnd.openxmlformats-officedocument.presentationml.presentation', wm);
  const zip = await require('jszip').loadAsync(out);
  assert.ok((await zip.file('ppt/slides/slide1.xml').async('string')).includes('alice'));
  const pdf = Buffer.from('%PDF-1.4');
  assert.strictEqual(await W.apply(pdf, 'application/pdf', wm), pdf);
  const broken = Buffer.from('not a zip');
  assert.strictEqual(await W.apply(broken, 'application/vnd.openxmlformats-officedocument.presentationml.presentation', wm), broken);
});
