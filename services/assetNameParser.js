'use strict';
/**
 * assetNameParser — attribue un site et un jeton de type à un nom de machine, à
 * partir d'une carte APPRISE sur les actifs SDP.
 *
 * Pourquoi apprise et non configurée : le parc porte cinq graphies de
 * « portable » (LAP, LTOP, LPT, LTP, LT), deux préfixes pour Hounde (HGO, HND)
 * et deux ères pour Sabodala (TGZSAB hérité de Teranga, EDVSAB actuel). Un
 * dictionnaire écrit à la main dériverait dès le mois suivant ; la carte apprise
 * se met à jour seule quand SDP grandit. Mesuré : 89 % du parc tombe dans une
 * tête portant au moins HEAD_MIN machines.
 *
 * C'est ce module qui permet d'attribuer un site à une machine ABSENTE de SDP —
 * le nom est alors la seule information dont on dispose.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CE QUE LE NOM DIT, ET CE QU'IL NE DIT PAS
 *
 * Le nom porte le site où la machine a été PROVISIONNÉE. Il ne porte pas le site
 * où elle se trouve. Quand un utilisateur est muté, son poste le suit, et c'est
 * la fiche SDP — qui suit l'utilisateur — qui devient exacte pendant que le nom
 * reste figé sur l'ancien site. `ABJ-LAP-531` enregistré à MANA n'est pas une
 * erreur de saisie : c'est un poste d'Abidjan dont l'utilisateur a bougé.
 *
 * Conséquences, toutes les deux à respecter :
 *
 *   • Pour un actif PRÉSENT dans SDP, la colonne `site` est autoritaire. Ce
 *     module ne doit jamais servir à la corriger ni à la contredire.
 *   • Pour un ÉCART (machine absente de SDP), le nom est tout ce qu'on a, et le
 *     site rendu est donc un site D'ORIGINE PRÉSUMÉ. L'appelant doit l'afficher
 *     comme tel — jamais comme la localisation courante, qui dépend d'un
 *     utilisateur que SDP ne connaît pas encore.
 *
 * Mesuré sur le parc : 99 % des attributions coïncident avec la colonne `site`.
 * Les ~1 % restants sont, pour l'essentiel, des utilisateurs mutés.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * PUR : aucune base de données, aucune horloge, aucun effet de bord.
 */

/**
 * Une tête portant moins de 3 machines ne suffit pas à attribuer un site : elle
 * pourrait n'être qu'une machine unique mal nommée. Sous ce seuil on rend null
 * et l'appelant affiche « site indéterminé » — jamais une supposition présentée
 * comme un fait.
 */
const HEAD_MIN = 3;

/**
 * Jetons de type observés dans le parc, DU PLUS LONG AU PLUS COURT.
 * L'ordre est load-bearing : `LT` placé avant `LTOP` raflerait `ITY-LTOP-5441`
 * et le type serait faux sans que rien ne signale l'erreur.
 * Sert à l'indice de type uniquement — le site vient de la carte apprise.
 */
const TYPE_TOKENS = ['LTOP', 'DESK', 'LPT', 'LTP', 'LAP', 'DSK', 'SRV', 'VM', 'WS', 'SW', 'AP', 'FW', 'LT'];

/**
 * Tête alphabétique : tout ce qui précède le premier chiffre, séparateurs ôtés.
 *   HGO-LAP-645     -> HGOLAP
 *   TGZSABWS703009  -> TGZSABWS
 * Une tête de moins de deux lettres n'est pas exploitable (`5`, `X1`).
 */
function head(name) {
  const s = String(name == null ? '' : name).trim().toUpperCase();
  const m = /^([A-Z\-_ .]+)/.exec(s);
  if (!m) return null;
  const h = m[1].replace(/[-_ .]/g, '');
  return h.length >= 2 ? h : null;
}

/**
 * rows: [{ asset_name, site }] → Map(tête → { site, purity, n })
 *
 * Un actif dont la colonne `site` est vide est IGNORÉ : le compter créerait une
 * tête pointant vers la chaîne vide, qui passerait ensuite pour un site connu.
 */
function learnPrefixMap(rows) {
  const acc = new Map();
  for (const r of rows || []) {
    const h = head(r && r.asset_name);
    if (!h) continue;
    const site = String((r && r.site) || '').trim();
    if (!site) continue;
    if (!acc.has(h)) acc.set(h, { n: 0, sites: new Map() });
    const g = acc.get(h);
    g.n++;
    g.sites.set(site, (g.sites.get(site) || 0) + 1);
  }
  const out = new Map();
  for (const [h, g] of acc) {
    let best = null;
    let bestN = 0;
    for (const [s, n] of g.sites) if (n > bestN) { best = s; bestN = n; }
    out.set(h, { site: best, purity: bestN / g.n, n: g.n });
  }
  return out;
}

/** Le jeton le PLUS LONG qui correspond gagne — voir TYPE_TOKENS. */
function typeToken(name) {
  const s = String(name == null ? '' : name).toUpperCase();
  for (const t of TYPE_TOKENS) {
    // séparé : HGO-LAP-01, EDV-LT-104 — pas suivi d'une autre lettre, sinon
    // `LT` matcherait le début de `LTOP`.
    if (new RegExp('[-_](' + t + ')(?![A-Z])').test(s)) return t;
    // collé : BFDSK397, EDVSABLT408004 — le jeton précède immédiatement le numéro.
    if (new RegExp('(' + t + ')[0-9]').test(s)) return t;
  }
  return null;
}

/**
 * → { site, purity, typeToken, head, reason }
 *
 * ⚠ `site` est le site d'ORIGINE présumé, déduit du nom — pas la localisation
 * courante. Voir l'en-tête du module : le site réel suit l'utilisateur, et le
 * nom reste figé quand celui-ci est muté.
 *
 * `site === null` signifie TOUJOURS « indéterminé », jamais « aucun site ».
 * `reason` dit pourquoi, pour que l'interface puisse l'expliquer :
 *   no_head | head_unknown | head_too_rare | ok
 */
function parseAssetName(name, prefixMap) {
  const h = head(name);
  const tok = typeToken(name);
  if (!h) return { site: null, purity: 0, typeToken: tok, head: null, reason: 'no_head' };
  const e = prefixMap && typeof prefixMap.get === 'function' ? prefixMap.get(h) : null;
  if (!e) return { site: null, purity: 0, typeToken: tok, head: h, reason: 'head_unknown' };
  if (e.n < HEAD_MIN) return { site: null, purity: 0, typeToken: tok, head: h, reason: 'head_too_rare' };
  return { site: e.site, purity: e.purity, typeToken: tok, head: h, reason: 'ok' };
}

module.exports = { learnPrefixMap, parseAssetName, head, typeToken, HEAD_MIN, TYPE_TOKENS };
