'use strict';
// G-12 (audit 2026-09-24) — READ-ONLY inventory of accounts and roles.
//
// 24 of 29 active accounts carry `admin`, and `_reportWriteDenial` exempts admin from
// the site check, so the site-scoping control shipped after the 2026-09-05 audit is
// inert for ~83 % of them. This prints who they are, per site, with a proposal — and
// names the accounts that would be LOCKED OUT by a careless downgrade (an `editor`
// without a site cannot write anything at all).
//
//   node tools/pg/audit-roles.js
//
// Nothing is written. The role change itself belongs in Admin ▸ Users, account by
// account, by a human reading this list — a bulk UPDATE here would be how a coordinator
// discovers on Monday that their weekly report is refused.
//
// .env FIRST: every *-db module picks its backend at require time and only server.js
// loads dotenv, so a standalone run without this reads the frozen SQLite archives.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const { formatRoleAudit } = require('../../services/roleAudit');

async function main() {
  if (!process.env.PG_URL) {
    console.error('PG_URL absent du .env — impossible de lire les comptes.');
    process.exitCode = 1;
    return;
  }
  const { Client } = require('pg');
  const c = new Client({ connectionString: process.env.PG_URL });
  await c.connect();
  try {
    // Roles live in BOTH places: the `role` column (the hierarchical level) and the
    // `user_roles` rows (level + feature roles). userHasRole reads the union, so this
    // must too — reading only one of them would under-report the problem.
    const rows = (await c.query(`
      SELECT u.id, u.username, u.full_name, u.site_id, s.name AS site_name,
             u.role AS base_role,
             COALESCE(ARRAY_AGG(r.role) FILTER (WHERE r.role IS NOT NULL), '{}') AS extra_roles
        FROM users u
        LEFT JOIN user_roles r ON r.user_id = u.id
        LEFT JOIN sites s ON s.id = u.site_id
       WHERE u.active = 1
       GROUP BY u.id, u.username, u.full_name, u.site_id, s.name, u.role
       ORDER BY u.username`)).rows;

    const users = rows.map(r => ({
      username: r.username,
      full_name: r.full_name,
      site_id: r.site_id,
      site_name: r.site_name,
      roles: [...new Set([r.base_role, ...(r.extra_roles || [])].filter(Boolean))],
    }));

    console.log(formatRoleAudit(users));
  } finally {
    await c.end();
  }
}

if (require.main === module) {
  main().catch(e => { console.error('[audit-roles]', e.message); process.exitCode = 1; });
}

module.exports = { main };
