'use strict';
// D3 (P10) — portfolio slide in the monthly Group IT pack, behind report_config exec_pack_portfolio_slide ('0' = today).
// Pure block: money masked unless admin tier / finance-viewer, null never 0; payload: no key while the switch is off;
// render.py: no extra slide without the key (deck unchanged), one "Portfolio Highlights" slide with it.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('node:child_process');
const JSZip = require('jszip');
const { buildPortfolioBlock, loadForAuthor } = require('../services/execPackPortfolio');
const { DEFAULTS } = require('../services/reportConfig');

const PF = {
  projects: [
    { id: 1, key: 'P-1', name: 'Fibre ring', status: 'in_progress', baseline_end: '2026-10-01', end_date: '2026-11-01', budget: 120000, currency: 'USD', site_id: 1 },
    { id: 2, key: 'P-2', name: 'ERP upgrade', status: 'planned', baseline_end: null, end_date: null, budget: null, currency: 'XOF', site_id: 2 },
    { id: 3, key: 'P-3', name: 'Old', status: 'done', budget: 5, currency: 'USD' },
  ],
  milestones: [
    { project_id: 1, name: 'Splice', due_date: '2026-11-01', status: 'planned' },
    { project_id: 1, name: 'Go-live', due_date: '2026-12-15', status: 'planned' },
    { project_id: 2, name: 'Kick-off', due_date: '2026-12-01', done_at: '2026-11-01', status: 'done' },
  ],
  benefits: [
    { project_id: 1, description: 'Less downtime', value_kind: 'quantity', unit: 'h', target_value: 10, review_date: '2027-01-01', realised_value: null },
    { project_id: 1, description: 'Savings', value_kind: 'money', currency: 'USD', target_value: 50000, review_date: '2027-02-01', realised_value: 1 },
  ],
};

test('switch default is off', () => { assert.strictEqual(DEFAULTS.exec_pack_portfolio_slide, '0'); });

test('block: open projects only, late vs baseline, overdue milestone, null stays null', () => {
  const b = buildPortfolioBlock(PF, { money: true, today: '2026-11-13' });
  assert.strictEqual(b.open_projects, 2);
  assert.strictEqual(b.late_vs_baseline, 1);
  assert.strictEqual(b.milestones_overdue, 1);
  const p2 = b.rows.find((r) => r.key === 'P-2');
  assert.deepStrictEqual([p2.finish_variance_days, p2.next_milestone, p2.budget], [null, null, null], 'unknown, never 0');
  assert.strictEqual(b.rows[0].key, 'P-1', 'latest first');
  assert.strictEqual(b.rows[0].budget, 120000);
});

test('block: no amount at all for an author without money rights', () => {
  const b = buildPortfolioBlock(PF, { money: false, today: '2026-11-13' });
  assert.strictEqual(b.money_hidden, true);
  const json = JSON.stringify(b);
  assert.ok(!/120000|50000/.test(json), 'no budget, no money benefit value');
  assert.ok(b.rows.every((r) => !('budget' in r) && !('currency' in r)));
  assert.ok(b.benefits.find((x) => x.description === 'Savings') && !('target_value' in b.benefits.find((x) => x.description === 'Savings')));
  assert.strictEqual(b.benefits.find((x) => x.description === 'Less downtime').target_value, 10, 'non-money benefit kept');
});

const stubRdb = (roles) => ({ db: {}, pgHandle: () => ({}), userHasRole: (u, r) => roles.includes(r) || (r === 'editor' && roles.includes('admin')) });
const store = { portfolio: async () => PF };

test('loadForAuthor: switch off → null (no slide); on → money only for admin tier / finance-viewer, committee-member masked', async () => {
  assert.strictEqual(await loadForAuthor({ id: 1 }, { rdb: stubRdb(['admin']), store, getConfig: async () => ({ exec_pack_portfolio_slide: '0' }) }), null);
  const on = async () => ({ exec_pack_portfolio_slide: '1' });
  assert.strictEqual((await loadForAuthor({ id: 1 }, { rdb: stubRdb(['admin']), store, getConfig: on })).money, true);
  assert.strictEqual((await loadForAuthor({ id: 1 }, { rdb: stubRdb(['finance-viewer']), store, getConfig: on })).money, true);
  assert.strictEqual((await loadForAuthor({ id: 1 }, { rdb: stubRdb(['committee-member']), store, getConfig: on })).money, false, 'invariant 2: no committee exception');
  // site scope: a scoped editor reads only the projects of their sites when portfolio_site_scope_reads = 1
  const ed = await loadForAuthor({ id: 2, site_id: 2, site_ids: [2], roles: ['editor'] }, { rdb: stubRdb(['editor']), store, getConfig: async () => ({ exec_pack_portfolio_slide: '1', portfolio_site_scope_reads: '1' }) });
  assert.deepStrictEqual(ed.rows.map((r) => r.key), ['P-2']);
});

test('reportPayload.build without a user adds no portfolio key (today\'s payload)', async () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'reportPayload.js'), 'utf8');
  assert.match(src, /if \(opts && opts\.user\)/, 'the block is only built for a known author');
});

function findPython() {
  for (const bin of ['python3', 'python']) { try { const r = spawnSync(bin, ['-c', 'import matplotlib, pptx, PIL'], { encoding: 'utf8' }); if (r && r.status === 0) return bin; } catch (_) { /* next */ } }
  return null;
}
const PY = findPython();
function staged() {
  const ROOT = path.join(__dirname, '..');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'exec-pf-'));
  const tool = path.join(tmp, 'tools', 'exec-pptx'), assets = path.join(tmp, 'public', 'brand', 'exec-pptx');
  fs.mkdirSync(tool, { recursive: true }); fs.mkdirSync(assets, { recursive: true });
  for (const f of fs.readdirSync(path.join(ROOT, 'tools', 'exec-pptx')).filter((x) => x.endsWith('.py'))) fs.copyFileSync(path.join(ROOT, 'tools', 'exec-pptx', f), path.join(tool, f));
  const real = path.join(ROOT, 'public', 'brand', 'exec-pptx');
  for (const f of ['em_banner.jpg', 'left_corner.png']) if (fs.existsSync(path.join(real, f))) fs.copyFileSync(path.join(real, f), path.join(assets, f));
  if (!fs.existsSync(path.join(assets, 'em_banner.jpg'))) {
    const mk = spawnSync(PY, ['-c', "import sys\nfrom PIL import Image\nImage.new('RGB',(1600,200),(31,61,92)).save(sys.argv[1],'JPEG')\nImage.new('RGBA',(200,200),(232,119,34,255)).save(sys.argv[2],'PNG')", path.join(assets, 'em_banner.jpg'), path.join(assets, 'left_corner.png')], { encoding: 'utf8' });
    assert.strictEqual(mk.status, 0, mk.stderr);
  }
  return path.join(tool, 'render.py');
}
async function render(script, payload) {
  const r = spawnSync(PY, [script], { input: JSON.stringify(payload), maxBuffer: 64 * 1024 * 1024 });
  assert.strictEqual(r.status, 0, String(r.stderr).slice(-800));
  const zip = await JSZip.loadAsync(r.stdout);
  const slides = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
  let text = ''; for (const f of slides) text += await zip.file(f).async('string');
  return { n: slides.length, text };
}

test('render.py: no portfolio key = no extra slide; with the key = one Portfolio Highlights slide (money masked)', { skip: PY ? false : 'python with matplotlib + python-pptx not available', timeout: 240000 }, async () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'tools', 'exec-pptx', 'fixtures', 'kpis-may.json'), 'utf8'));
  const script = staged();
  const a = await render(script, fixture);
  assert.ok(!a.text.includes('Portfolio Highlights'));
  const b = await render(script, { ...fixture, portfolio: buildPortfolioBlock(PF, { money: false, today: '2026-11-13' }) });
  assert.strictEqual(b.n, a.n + 1);
  assert.ok(b.text.includes('Portfolio Highlights') && b.text.includes('Fibre ring'));
  assert.ok(!b.text.includes('120,000'), 'no amount for a masked author');
});
