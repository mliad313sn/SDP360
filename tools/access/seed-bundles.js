'use strict';
// P5 / goal A4 — the two access BUNDLES, shipped as DRAFT access templates (C-18, migration 057):
//   site-coordinator   "Site Coordinator"   editor + tracker-editor, on the person's primary site
//   committee-member   "Committee Member"   committee-member (group scope)
// A template grants NOTHING by itself: a request filed from a PUBLISHED version still needs an approval bound to one
// user × roles × sites × dates. This script only creates DRAFTS — PUBLISHING IS A HUMAN ACT (Admin ▸ Access, super_admin)
// and it never publishes, never files a request, never touches a user.
//
//   node tools/access/seed-bundles.js            # DRY RUN — prints the plan, writes nothing
//   node tools/access/seed-bundles.js --apply    # creates the missing templates + one draft version each
//
// Idempotent: an existing key is left alone (its versions are reported, never edited — a published one is immutable).
const path = require('path');
if (require.main === module) require('dotenv').config({ quiet: true, path: path.join(__dirname, '..', '..', '.env') });

const BUNDLES = Object.freeze([
  { key: 'site-coordinator', title_en: 'Site Coordinator', title_fr: 'Coordinateur de site',
    intended_position: 'The IT coordinator of ONE site: writes that site\'s reports, meetings, inspections and tracker inputs (locked to the site).',
    payload: { roles: ['editor', 'tracker-editor'], site_rule: 'primary', max_days: 365 } },
  { key: 'committee-member', title_en: 'Committee Member', title_fr: 'Membre du comité',
    intended_position: 'A member of the IT governance committee: runs and records committee sessions, reads the portfolio.',
    payload: { roles: ['committee-member'], site_rule: 'primary', max_days: 365 } },
]);

/** Pure plan: which bundles to create, which already exist. Throws when a bundle role is unknown (never silently dropped). */
function plan(existing, knownRoles) {
  const L = require('../../services/accessRequestLifecycle');
  const out = [];
  for (const b of BUNDLES) {
    const v = L.validateTemplatePayload(b.payload, { knownRoles });
    if (v.error) throw new Error(`${b.key}: ${v.error.error || JSON.stringify(v.error)}`);
    const ex = (existing || []).find((t) => t.key === b.key);
    out.push(ex ? { key: b.key, action: 'exists', versions: (ex.versions || []).map((x) => `v${x.version} ${x.status}`) }
      : { key: b.key, action: 'create', roles: v.value.roles, site_rule: v.value.site_rule, max_days: v.value.max_days });
  }
  return out;
}

async function main({ argv = process.argv.slice(2), rdb = null, log = console.log } = {}) {
  const apply = argv.includes('--apply');
  const R = rdb || require('../../reports-db');
  if (!rdb && R.initPgReports) await R.initPgReports();
  const store = require('../../services/accessStore').forRdb(R);
  const known = [...(R.ROLE_HIERARCHY || []), ...(R.FEATURE_ROLES_KNOWN || [])];
  const steps = plan(await store.listTemplates({ includeDrafts: true }), known);
  const created = [];
  for (const s of steps) {
    log(`${apply ? '' : '[dry-run] '}${s.key}: ${s.action === 'exists' ? 'exists (' + (s.versions.join(', ') || 'no version') + ') — left alone' : 'create DRAFT roles=' + s.roles.join('+') + ' site_rule=' + s.site_rule + ' max_days=' + s.max_days}`);
    if (!apply || s.action !== 'create') continue;
    const b = BUNDLES.find((x) => x.key === s.key);
    const id = await store.createTemplate(b, { actorId: null });
    const vid = await store.addVersion(id, b.payload, { actorId: null });
    created.push({ key: b.key, template_id: id, version_id: vid });
  }
  log(apply ? `created ${created.length} draft template(s). Publishing is a human act (Admin ▸ Access, super_admin).` : 'dry run — nothing written. Re-run with --apply.');
  return { apply, steps, created };
}

module.exports = { BUNDLES, plan, main };
if (require.main === module) main().then(() => process.exit(0), (e) => { console.error(e.message); process.exit(1); });
