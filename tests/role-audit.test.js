'use strict';
// G-12 (audit 2026-09-24) — the role inventory that has to exist before anyone is
// downgraded.
//
// 24 of 29 active accounts carry `admin`, and `_reportWriteDenial` (server.js:5469)
// exempts admin from the site check — so the site-scoping control shipped after the
// 2026-09-05 audit is inert for ~83 % of the fleet of accounts.
//
// The dangerous part is the FIX, not the finding: an `editor` WITHOUT a site cannot
// write anything at all (same rule, other branch). Downgrading a coordinator who has no
// site set would lock them out of their own weekly report on Monday morning. So the tool
// classifies every account and names that case loudly, instead of handing someone a bulk
// UPDATE.
const test = require('node:test');
const assert = require('node:assert');
const { classifyAccount, formatRoleAudit } = require('../services/roleAudit');

const u = (over = {}) => ({ username: 'x', full_name: 'X', roles: ['admin'], site_id: 1, site_name: 'MANA', ...over });

test('an admin WITH a site is the account to look at: probably a coordinator', () => {
  const c = classifyAccount(u({ roles: ['admin'], site_id: 3, site_name: 'HOUNDE' }));
  assert.strictEqual(c.verdict, 'over_privileged');
  assert.match(c.why, /site/i);
  assert.strictEqual(c.proposal, 'editor');
});

test('an admin WITHOUT a site is central IT — flagged to confirm, never auto-downgraded', () => {
  const c = classifyAccount(u({ roles: ['admin'], site_id: null, site_name: null }));
  assert.strictEqual(c.verdict, 'central');
  assert.strictEqual(c.proposal, null, 'nothing is proposed for an account we cannot judge');
});

test('an editor WITHOUT a site is BLOCKED and must be named first', () => {
  const c = classifyAccount(u({ roles: ['editor'], site_id: null, site_name: null }));
  assert.strictEqual(c.verdict, 'blocked');
  assert.match(c.why, /ne peut (rien )?écrire|aucun site/i);
});

test('an editor with a site is exactly what the control expects', () => {
  assert.strictEqual(classifyAccount(u({ roles: ['editor'], site_id: 2, site_name: 'ITY' })).verdict, 'ok');
});

test('super_admin is never proposed for a downgrade', () => {
  const c = classifyAccount(u({ roles: ['super_admin'], site_id: null, site_name: null }));
  assert.strictEqual(c.verdict, 'ok');
  assert.strictEqual(c.proposal, null);
});

test('a feature role alongside admin does not change the verdict', () => {
  const c = classifyAccount(u({ roles: ['admin', 'report-author', 'audit-viewer'], site_id: 1, site_name: 'MANA' }));
  assert.strictEqual(c.verdict, 'over_privileged');
});

test('the report counts each class and states the danger before the list', () => {
  const out = formatRoleAudit([
    u({ username: 'coord1', roles: ['admin'], site_id: 1, site_name: 'MANA' }),
    u({ username: 'coord2', roles: ['admin'], site_id: 2, site_name: 'ITY' }),
    u({ username: 'central', roles: ['admin'], site_id: null, site_name: null }),
    u({ username: 'stuck', roles: ['editor'], site_id: null, site_name: null }),
  ]);
  assert.match(out, /coord1/);
  assert.match(out, /2 compte/, 'the over-privileged are counted');
  assert.match(out, /BLOQU/i, 'the blocked account is impossible to miss');
  assert.ok(out.indexOf('site') < out.indexOf('coord1'), 'the warning comes before the list');
});

test('an empty fleet of accounts says so instead of printing an empty success', () => {
  assert.match(formatRoleAudit([]), /aucun compte/i);
});

test('the report never prints a secret', () => {
  const out = formatRoleAudit([u({ username: 'a', password_hash: 'HASH', salt: 'SALT', email: 'a@b.c' })]);
  for (const s of ['HASH', 'SALT']) assert.ok(!out.includes(s), `${s} must not reach the output`);
});
