'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildReconcileView } = require('../services/reconcileView');
const { TYPES } = require('../services/assetTypeClassifier');

const REC = (o) => buildReconcileView(Object.assign({
  sdpAssets: [], externalDevices: [], decisions: [],
  asOf: '2026-07-23', recentDays: 30, staleDays: 90,
}, o));

const seen = (n, days) => new Date(Date.parse('2026-07-23') - days * 86400000).toISOString();

// ── Enrichissement d'un ecart ───────────────────────────────────────────────
test('un ecart porte son site ET la source de cette attribution', () => {
  // Sans la source, personne ne sait si le site vient de l'OU (fiable) ou du
  // nom (le site de PROVISIONNEMENT, pas forcement l actuel). Les deux ne se
  // corrigent pas de la meme facon.
  const v = REC({
    sdpAssets: [{ asset_name: 'HGO-LAP-001', site: 'HOUNDE' }],
    externalDevices: [{
      source: 'ad', device_name: 'HGO-LAP-777', enabled: true, last_seen: seen(1, 2),
      ou_dn: 'CN=HGO-LAP-777,OU=Laptops,OU=Computers,OU=Hounde Gold Operations,DC=edv-ops,DC=com',
    }],
  });
  assert.strictEqual(v.gaps.length, 1);
  // Un seul actif SDP ne suffit pas a APPRENDRE l OU : on retombe sur son
  // libelle, qui est le nom de l unite organisationnelle et NON le code site
  // de SDP. C est pour cela que `site_source` doit etre affiche a cote du
  // site : 'Hounde Gold Operations' et 'HOUNDE' ne se corrigent pas pareil.
  assert.strictEqual(v.gaps[0].site, 'Hounde Gold Operations');
  assert.strictEqual(v.gaps[0].site_source, 'ou_label');
});

test('un ecart porte son type ET la source du type', () => {
  const v = REC({
    externalDevices: [{
      source: 'defender', device_name: 'X1', enabled: true, last_seen: seen(1, 2),
      model: 'EliteBook 840 G8', vendor: 'HP', os: 'Windows 11',
    }],
  });
  assert.strictEqual(v.gaps[0].type, TYPES.LAPTOP);
  assert.ok(v.gaps[0].type_source, 'la source du type est toujours renseignee');
});

test('un site introuvable rend null, jamais une valeur inventee', () => {
  const v = REC({ externalDevices: [{ source: 'ad', device_name: 'ZZZZ9', enabled: true, last_seen: seen(1, 2) }] });
  assert.strictEqual(v.gaps[0].site, null);
  assert.strictEqual(v.gaps[0].site_source, null);
});

// ── Regroupements ───────────────────────────────────────────────────────────
test('les ecarts sont groupes par site, indetermines compris', () => {
  const v = REC({
    externalDevices: [
      { source: 'ad', device_name: 'A', enabled: true, last_seen: seen(1, 2), ou_dn: 'CN=A,OU=Kalana,DC=edv-ops,DC=com' },
      { source: 'ad', device_name: 'B', enabled: true, last_seen: seen(1, 3), ou_dn: 'CN=B,OU=Kalana,DC=edv-ops,DC=com' },
      { source: 'ad', device_name: 'ZZZZ9', enabled: true, last_seen: seen(1, 4) },
    ],
  });
  const k = v.by_site.find((r) => /kalana/i.test(String(r.site)));
  assert.strictEqual(k.n, 2);
  assert.ok(v.by_site.some((r) => r.site === null), 'les indetermines forment leur propre groupe, ils ne disparaissent pas');
});

test('un site ecrit differemment selon la source ne forme PAS deux groupes', () => {
  // resolveSite rend le libelle d OU tel quel sur le chemin ou_label
  // ('Kalana') et le site SDP sur le chemin ou_learned ('KALANA'). Groupes
  // bruts, le meme site apparaitrait deux fois et un coordinateur lirait deux
  // problemes la ou il n y en a qu un.
  const sdp = [];
  for (let i = 0; i < 12; i++) sdp.push({ asset_name: 'KAL-REF-' + i, site: 'KALANA' });
  const ext = sdp.map((a, i) => ({
    source: 'ad', device_name: a.asset_name, enabled: true, last_seen: seen(1, 2),
    ou_dn: 'CN=' + a.asset_name + ',OU=Kalana,DC=edv-ops,DC=com',
  }));
  // Une 13e machine, absente de SDP : c est l ecart. L OU 'Kalana' est apprise
  // par les 12 autres, donc elle ressort en 'KALANA' (ou_learned).
  ext.push({ source: 'ad', device_name: 'KAL-NEW-1', enabled: true, last_seen: seen(1, 2),
    ou_dn: 'CN=KAL-NEW-1,OU=Kalana,DC=edv-ops,DC=com' });
  // Une 14e sous une OU jamais apprise, dont le libelle est la casse mixte.
  ext.push({ source: 'ad', device_name: 'KAL-NEW-2', enabled: true, last_seen: seen(1, 2),
    ou_dn: 'CN=KAL-NEW-2,OU=kalana,DC=edv-ops,DC=com' });

  const v = REC({ sdpAssets: sdp, externalDevices: ext });
  const groups = v.by_site.filter((r) => /kalana/i.test(String(r.site)));
  assert.strictEqual(groups.length, 1, 'un seul groupe Kalana, quelle que soit la casse');
  assert.strictEqual(groups[0].n, 2);
  assert.strictEqual(v.counts.sites_touched, 1);
});

test('les ecarts sont AUSSI groupes par OU — c est l unite d action GPO', () => {
  // On rattache une GPO a une OU, pas a un site. Un site couvre plusieurs OU
  // (Exploration Sites porte Tanda, Ity et Hounde), donc le groupement par
  // site ne se traduit pas en action de deploiement.
  const dn = (n, ou) => `CN=${n},OU=${ou},OU=Computers,OU=Kalana,DC=edv-ops,DC=com`;
  const v = REC({
    externalDevices: [
      { source: 'ad', device_name: 'A', enabled: true, last_seen: seen(1, 2), ou_dn: dn('A', 'Laptops') },
      { source: 'ad', device_name: 'B', enabled: true, last_seen: seen(1, 2), ou_dn: dn('B', 'Laptops') },
      { source: 'ad', device_name: 'C', enabled: true, last_seen: seen(1, 2), ou_dn: dn('C', 'Desktops') },
    ],
  });
  const lap = v.by_ou.find((r) => /OU=Laptops/.test(r.ou_dn));
  assert.strictEqual(lap.gaps, 2);
  assert.strictEqual(lap.total, 2, 'le total AD du conteneur est reporte — 2/2 et 2/400 n appellent pas la meme action');
  assert.strictEqual(v.by_ou[0].gaps, 2, 'le plus gros conteneur en tete : cet ordre EST la liste de travail');
});

test('le groupement par OU ignore les machines sans OU plutot que d inventer un groupe', () => {
  // Entra et Defender ne portent pas d OU. Les mettre dans un seau "(aucune)"
  // ferait croire a un conteneur a rattacher qui n existe pas.
  const v = REC({ externalDevices: [{ source: 'entra', device_name: 'M1', enabled: true, last_seen: seen(1, 2) }] });
  assert.strictEqual(v.gaps.length, 1);
  assert.strictEqual(v.by_ou.length, 0);
});

// ── Decisions ───────────────────────────────────────────────────────────────
test('une machine traitee ou hors perimetre sort du compteur mais reste visible', () => {
  // La faire disparaitre empecherait de revenir sur la decision, et deux
  // rapports successifs deviendraient inexplicablement differents.
  const ext = [
    { source: 'ad', device_name: 'A1', enabled: true, last_seen: seen(1, 2) },
    { source: 'ad', device_name: 'B1', enabled: true, last_seen: seen(1, 2) },
  ];
  const v = REC({ externalDevices: ext, decisions: [{ device_key: 'A1', decision: 'out_of_scope', reason: 'poste de pret' }] });
  assert.strictEqual(v.counts.gaps_open, 1, 'seul B1 reste a traiter');
  assert.strictEqual(v.counts.gaps, 2, 'le total brut reste affiche');
  const a = v.gaps.find((g) => g.device_key === 'A1');
  assert.strictEqual(a.decision, 'out_of_scope');
  assert.strictEqual(a.reason, 'poste de pret');
});

test('une decision sur une machine qui n est plus un ecart ne casse rien', () => {
  const v = REC({ decisions: [{ device_key: 'DISPARUE', decision: 'handled' }] });
  assert.strictEqual(v.counts.gaps, 0);
  assert.strictEqual(v.counts.gaps_open, 0);
});

// ── Sens inverse ────────────────────────────────────────────────────────────
test('le materiel reseau n est jamais candidat au retrait, et l exclusion est chiffree', () => {
  // Un switch ne rejoint jamais un domaine : absent d AD par nature, donc
  // "jamais vu", donc candidat a tort et pour toujours.
  const v = REC({
    sdpAssets: [
      { asset_name: 'SW-01', site: 'ITY', product_type: 'Cisco Switch' },
      { asset_name: 'LAP-01', site: 'ITY', product_type: 'Computer' },
    ],
    // Une source EST importee : sans elle, le garde d applicabilite rend zero
    // candidat et le test ne prouverait plus rien sur l exclusion.
    externalDevices: [{ source: 'ad', device_name: 'AUTRE-1', enabled: true, last_seen: seen(1, 2) }],
  });
  assert.deepStrictEqual(v.retirement_candidates.map((x) => x.asset_name), ['LAP-01']);
  assert.strictEqual(v.counts.retirement_excluded_not_joinable, 1);
});

// ── Le sens inverse trie les VRAIS retraits des artefacts de fiche SDP ───────
// Une machine absente d'AD n'est pas forcement partie : SDP dedoublonne par
// SERVICE TAG (doc ManageEngine), donc un renommage / une reinstallation cree
// souvent un doublon ou une fiche "_old", pas un retrait. Et un actif "In Store"
// est deliberement hors reseau. Ces cas polluent la liste.
const IN_USE = (a) => Object.assign({ state: 'In Use', last_audit_status: 'Scan Success',
  last_successful_audit_time: '2026-07-20T00:00:00Z', serial_number: 'SN-' + a.asset_name }, a);
// Une source datee pour rendre le retrait applicable.
const ONE_SRC = [{ source: 'ad', device_name: 'AUTRE-1', enabled: true, last_seen: seen(1, 2) }];

test('un actif In Use, scanne, service tag unique -> vrai candidat au retrait', () => {
  const v = REC({ sdpAssets: [IN_USE({ asset_name: 'PC-01', site: 'ITY' })], externalDevices: ONE_SRC });
  assert.deepStrictEqual(v.retirement_candidates.map((x) => x.asset_name), ['PC-01']);
});

test('un actif "In Store" est ECARTE — il est deliberement hors reseau', () => {
  const v = REC({ sdpAssets: [IN_USE({ asset_name: 'DSK-628', site: 'HGO', state: 'In Store' })], externalDevices: ONE_SRC });
  assert.strictEqual(v.retirement_candidates.length, 0);
  assert.strictEqual(v.counts.retirement_excluded_off_network, 1);
  const r = v.retirement_review.find((x) => x.asset_name === 'DSK-628');
  assert.strictEqual(r.reason, 'off_network');
});

test('un service tag partage par un AUTRE actif = renommage probable, pas un retrait', () => {
  // SDP identifie par service tag : deux fiches, meme tag -> la machine vit sous
  // l'autre. C'est une fiche a corriger, pas une machine perdue.
  const v = REC({
    sdpAssets: [
      IN_USE({ asset_name: 'PC-OLD', site: 'ITY', serial_number: '9HKJSM2' }),   // absente d'AD
      IN_USE({ asset_name: 'PC-NEW', site: 'ITY', serial_number: '9HKJSM2' }),   // le meme materiel, actif
    ],
    externalDevices: [{ source: 'ad', device_name: 'PC-NEW', enabled: true, last_seen: seen(1, 2) }],
  });
  assert.ok(!v.retirement_candidates.some((x) => x.asset_name === 'PC-OLD'), 'pas un candidat');
  assert.strictEqual(v.counts.retirement_excluded_renamed, 1);
  assert.strictEqual(v.retirement_review.find((x) => x.asset_name === 'PC-OLD').reason, 'renamed');
});

test('une fiche dont le nom finit par _old = signature de renommage SDP', () => {
  const v = REC({ sdpAssets: [IN_USE({ asset_name: 'HGO-DSK-628_old', site: 'HGO' })], externalDevices: ONE_SRC });
  assert.strictEqual(v.retirement_candidates.length, 0);
  assert.strictEqual(v.counts.retirement_excluded_renamed, 1);
});

test('un actif jamais scanne avec succes est ECARTE — sa presence n a jamais ete confirmee', () => {
  const v = REC({ sdpAssets: [IN_USE({ asset_name: 'PC-GHOST', site: 'ITY',
    last_audit_status: '', last_successful_audit_time: '' })], externalDevices: ONE_SRC });
  assert.strictEqual(v.retirement_candidates.length, 0);
  assert.strictEqual(v.counts.retirement_excluded_never_scanned, 1);
});

test('sans metadonnee SDP (fixtures), on ne SUR-ecarte pas : l actif reste candidat', () => {
  // Un actif sans state/serial/scan connus ne doit pas etre exclu par defaut —
  // sinon la moindre donnee incomplete viderait la liste.
  const v = REC({ sdpAssets: [{ asset_name: 'BARE-1', site: 'ITY' }], externalDevices: ONE_SRC });
  assert.deepStrictEqual(v.retirement_candidates.map((x) => x.asset_name), ['BARE-1']);
});

test('les exclusions du retrait portent toutes leurs cles, meme a zero', () => {
  const v = REC({ externalDevices: ONE_SRC });
  for (const k of ['retirement_excluded_not_joinable', 'retirement_excluded_renamed',
    'retirement_excluded_off_network', 'retirement_excluded_never_scanned']) {
    assert.ok(k in v.counts, k + ' present');
  }
});

// ── Fenetre et compteurs ────────────────────────────────────────────────────
test('asOf est injecte de bout en bout — aucune horloge interne', () => {
  const ext = [{ source: 'ad', device_name: 'X', enabled: true, last_seen: '2026-06-01T00:00:00Z' }];
  assert.strictEqual(REC({ externalDevices: ext, asOf: '2026-06-10' }).counts.gaps, 1);
  assert.strictEqual(REC({ externalDevices: ext, asOf: '2026-09-10' }).counts.gaps, 0);
});

test('la fenetre est renvoyee — un chiffre sans sa fenetre ne veut rien dire', () => {
  const v = REC({ recentDays: 45, staleDays: 120 });
  assert.deepStrictEqual(v.window, { as_of: '2026-07-23', recent_days: 45, stale_days: 120 });
});

test('entrees vides : aucun jet, tout a zero', () => {
  const v = buildReconcileView({});
  assert.strictEqual(v.counts.gaps, 0);
  assert.deepStrictEqual(v.by_site, []);
  assert.deepStrictEqual(v.by_ou, []);
});

test('les sites touches sont comptes sans les indetermines', () => {
  // "3 sites touches" doit vouloir dire trois sites nommes. Compter le seau
  // des indetermines comme un site gonfle le chiffre d un site fictif.
  const v = REC({
    externalDevices: [
      { source: 'ad', device_name: 'A', enabled: true, last_seen: seen(1, 2), ou_dn: 'CN=A,OU=Kalana,DC=edv-ops,DC=com' },
      { source: 'ad', device_name: 'ZZZZ9', enabled: true, last_seen: seen(1, 2) },
    ],
  });
  assert.strictEqual(v.counts.sites_touched, 1);
});
