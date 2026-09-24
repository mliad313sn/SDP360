'use strict';
// G-12 (audit 2026-09-24) — classify accounts before anyone is downgraded.
//
// THE FINDING: 24 of 29 active accounts carry `admin`, and `_reportWriteDenial`
// (server.js:5469) exempts admin from the site check — so the site-scoping control
// shipped after the 2026-09-05 audit is inert for ~83 % of accounts, and `requireAdmin`
// routes (deleting a report, re-opening it, the PPTX exports, and since G-11 the money)
// are open to all of them.
//
// THE DANGER IS THE FIX. The same rule has another branch: an `editor` WITHOUT a site
// cannot write ANYTHING. Downgrade a coordinator whose account has no site and you lock
// them out of their own weekly report on Monday morning. That is why this module
// classifies and proposes, and why the CLI around it only ever READS — the change itself
// belongs to a human looking at the list.
//
// PURE: no database, no clock. tools/pg/audit-roles.js supplies the rows.

const has = (u, role) => Array.isArray(u && u.roles) && u.roles.includes(role);

/**
 * classifyAccount(user) → { verdict, why, proposal }
 *   over_privileged — admin WITH a site: almost certainly a site coordinator who only
 *                     needs `editor`; today they can write every other site's report.
 *   central         — admin WITHOUT a site: plausibly central IT. Flagged to confirm,
 *                     never proposed for a downgrade: we cannot tell from the data.
 *   blocked         — editor WITHOUT a site: cannot write at all. Fix the site first.
 *   ok              — nothing to say.
 */
function classifyAccount(user) {
  const u = user || {};
  const site = u.site_id != null && u.site_id !== '' ? u.site_id : null;

  if (has(u, 'super_admin')) {
    return { verdict: 'ok', why: 'super_admin — hors du périmètre de cette revue.', proposal: null };
  }
  if (has(u, 'admin')) {
    return site
      ? {
        verdict: 'over_privileged',
        why: `admin ET rattaché à un site (${u.site_name || site}) : le contrôle de site ne s'applique pas à lui, `
          + "il peut écrire et supprimer le rapport de n'importe quel autre site.",
        proposal: 'editor',
      }
      : {
        verdict: 'central',
        why: "admin sans site : probablement l'équipe centrale. À confirmer — la donnée ne permet pas de trancher.",
        proposal: null,
      };
  }
  if (has(u, 'editor') && !site) {
    return {
      verdict: 'blocked',
      why: "editor sans aucun site : ne peut écrire AUCUN rapport (403). À corriger AVANT toute rétrogradation d'un autre compte.",
      proposal: null,
    };
  }
  return { verdict: 'ok', why: '', proposal: null };
}

const pad = (s, n) => String(s == null ? '' : s).padEnd(n);

function formatRoleAudit(users) {
  const rows = Array.isArray(users) ? users : [];
  const L = [];
  L.push('COMPTES ET RÔLES — revue avant rétrogradation');
  L.push('');
  if (!rows.length) {
    L.push('Aucun compte actif à examiner.');
    return L.join('\n');
  }

  // The warning comes BEFORE the list: whoever reads this is about to change accounts.
  L.push('⚠ Un compte `editor` SANS site ne peut écrire aucun rapport. Avant de rétrograder');
  L.push('  un admin en editor, vérifier que son site est renseigné — sinon il est bloqué');
  L.push('  dès le lundi matin. Rien n\'est modifié par cet outil : il ne fait que lire.');
  L.push('');

  const classified = rows.map(u => ({ u, c: classifyAccount(u) }));
  const by = (v) => classified.filter(x => x.c.verdict === v);

  const blocked = by('blocked');
  if (blocked.length) {
    L.push(`BLOQUÉS — ${blocked.length} compte(s) qui ne peuvent rien écrire aujourd'hui :`);
    for (const { u } of blocked) L.push(`  ! ${pad(u.username, 22)} ${u.full_name || ''}`);
    L.push('');
  }

  const over = by('over_privileged');
  L.push(`SUR-PRIVILÉGIÉS — ${over.length} compte(s) admin rattachés à un site :`);
  if (!over.length) L.push('  (aucun)');
  for (const { u } of over) {
    L.push(`  - ${pad(u.username, 22)} ${pad(u.site_name || u.site_id, 14)} ${u.full_name || ''}`);
  }
  L.push('  → proposition : editor (+ les rôles fonctionnels utiles), site conservé.');
  L.push('');

  const central = by('central');
  L.push(`À CONFIRMER — ${central.length} compte(s) admin sans site (équipe centrale ?) :`);
  if (!central.length) L.push('  (aucun)');
  for (const { u } of central) L.push(`  ? ${pad(u.username, 22)} ${u.full_name || ''}`);
  L.push('');

  L.push(`Total examiné : ${rows.length} compte(s) actif(s).`);
  L.push('La modification se fait dans Admin ▸ Users, compte par compte, en vérifiant le site.');
  return L.join('\n');
}

module.exports = { classifyAccount, formatRoleAudit };
