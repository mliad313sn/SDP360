# Réconciliation Assets — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Détecter les machines vues récemment dans Active Directory ou Entra ID mais absentes de SDP — l'angle mort que laisse SelfScan quand un déploiement GPO rate un poste — et produire par site une liste sur laquelle un coordonnateur peut agir.

**Architecture:** Trois couches, une seule remplaçable. L'acquisition (CSV aujourd'hui, Microsoft Graph plus tard) alimente une normalisation pure (`assetNameParser` + `assetTypeClassifier`), qui alimente une comparaison pure (`reconcileAssets`) opérant sur deux listes en mémoire. Le moteur ne connaît ni CSV ni Graph. Tout est **additif** : aucun lecteur, aucune table, aucune route existante n'est modifiée.

**Tech Stack:** Node.js, better-sqlite3 + PostgreSQL (double backend), `node:test`, PowerShell 5.1 (`System.DirectoryServices`), Chart.js côté page.

**Spec:** `docs/superpowers/specs/2026-07-23-assets-reconciliation-design.md`

**Branche:** `feat/assets-reconciliation`

---

## Périmètre

### Livré par ce plan

Tâches 1 à 10 : le collecteur AD, les trois services purs, le parseur d'import, les deux tables, les routes, le 7ᵉ onglet, l'export Excel, la documentation de la page.

### Explicitement HORS périmètre — bloqué

**L'export « CSV au format d'import SDP »** (spec §4.3, route `GET /api/assets/reconcile/export-sdp.csv`). Le format du modèle derrière le bouton « Import from CSV » de SDP est inconnu. **Il ne sera pas deviné** : un CSV aux mauvaises colonnes échoue à l'import, ou pire, crée des actifs malformés dans l'inventaire de production.

Cette route n'est **pas** implémentée. Le bouton correspondant n'apparaît **pas** dans l'interface. Dès qu'un modèle d'export SDP est fourni, c'est une tâche 11 d'une demi-journée — le jeu de données à exporter est déjà calculé par `reconcileAssets`.

### Ordre imposé par une dépendance de données

**La tâche 1 (collecteur PowerShell) vient en premier et se livre seule.** Elle produit l'échantillon d'export AD qui manque pour caler les noms de colonnes de la tâche 4. Sans elle, le parseur d'import serait écrit contre des colonnes supposées.

---

## Structure des fichiers

| Fichier | Responsabilité |
|---|---|
| `tools/reconcile/Collect-ADComputers.ps1` | Interroge l'annuaire par `DirectorySearcher`, écrit un CSV UTF-8 BOM. Aucune dépendance, aucun droit admin. |
| `services/assetNameParser.js` | **Pur.** Apprend la carte tête→site depuis les actifs SDP, attribue site + jeton de type à un nom quelconque. |
| `services/assetTypeClassifier.js` | **Pur.** Cascade `product_type` → `product` → nom → OS. Vocabulaire canonique unique. |
| `services/reconcileAssets.js` | **Pur.** Clé normalisée, déduplication, écarts, sens inverse. Ne connaît aucune source. |
| `services/reconcileImport.js` | Parse un CSV AD ou Entra **par nom d'en-tête**. Convertit FILETIME. Nomme la colonne requise manquante. |
| `assets-db.js` (ajouts) | Tables `asset_external_devices` + `asset_reconcile_decisions`, lecteurs double backend. |
| `db/postgres/assets/001_init.sql` | Les deux tables, dans le CREATE **partagé** exécuté sur les deux backends. |
| `server.js` (ajouts) | 7 routes sous `/api/assets/reconcile/`. |
| `public/assets.html` (ajouts) | 7ᵉ onglet `#reconcile` + panneau `REC_PANE` + guide FR + feuille d'impression. |
| `services/reportConfig.js` | Clé `reconcile_recent_days`. |

---

## Task 1 : Le collecteur PowerShell (livrable seul)

**Files:**
- Create: `tools/reconcile/Collect-ADComputers.ps1`
- Test: manuel — c'est un script d'annuaire, il n'a pas de harnais dans ce dépôt

- [ ] **Step 1: Écrire le script**

Contraintes non négociables, toutes vérifiées en revue de spec :
- **Pas de `Get-ADComputer`** — exige RSAT, absent d'un poste courant.
- **Pur ASCII** — piège ANSI de PowerShell 5.1 documenté dans `tools/installer/*.ps1`.
- **Aucun droit admin** — lire les objets ordinateur est un droit de tout compte du domaine.

```powershell
# =====================================================================
# Collect-ADComputers.ps1 - export des objets ordinateur du domaine.
#
#   powershell -ExecutionPolicy Bypass -File Collect-ADComputers.ps1
#   ... -OutFile C:\Temp\ad.csv    (defaut: AD-computers_<date>.csv ici)
#
# N'UTILISE PAS Get-ADComputer : cette cmdlet exige RSAT, absent d'un poste
# courant, et le script echouerait chez la moitie des operateurs.
# DirectorySearcher est natif sur tout Windows joint au domaine.
#
# Aucun droit administrateur requis. Lecture seule.
# KEEP THIS FILE PURE ASCII (Windows PowerShell 5.1 ANSI parse pitfall).
# =====================================================================
param([string]$OutFile)
$ErrorActionPreference = 'Stop'

if (-not $OutFile) { $OutFile = Join-Path (Get-Location) ('AD-computers_' + (Get-Date -Format 'yyyyMMdd') + '.csv') }

try { $root = [ADSI]'LDAP://RootDSE'; $base = 'LDAP://' + $root.defaultNamingContext }
catch { Write-Host '[ERREUR] Machine non jointe au domaine, ou annuaire injoignable.' -ForegroundColor Red; exit 1 }

$s = New-Object System.DirectoryServices.DirectorySearcher
$s.SearchRoot = New-Object System.DirectoryServices.DirectoryEntry($base)
$s.Filter = '(objectCategory=computer)'
$s.PageSize = 1000                      # sans pagination l'annuaire s'arrete a 1000 objets
foreach ($p in 'name','dNSHostName','operatingSystem','operatingSystemVersion','lastLogonTimestamp','whenCreated','distinguishedName','userAccountControl') { [void]$s.PropertiesToLoad.Add($p) }

$rows = @()
foreach ($r in $s.FindAll()) {
    $p = $r.Properties
    $g = { param($k) if ($p[$k].Count -gt 0) { $p[$k][0] } else { '' } }
    # lastLogonTimestamp est un FILETIME 64 bits, PAS une date. Non converti il
    # sort en 133000000000000000 et toute comparaison de fraicheur est fausse.
    $ll = ''
    if ($p['lastlogontimestamp'].Count -gt 0) {
        try { $ll = [DateTime]::FromFileTimeUtc([Int64]$p['lastlogontimestamp'][0]).ToString('yyyy-MM-ddTHH:mm:ssZ') } catch { $ll = '' }
    }
    $uac = 0; if ($p['useraccountcontrol'].Count -gt 0) { $uac = [int]$p['useraccountcontrol'][0] }
    $rows += [PSCustomObject]@{
        name                   = (& $g 'name')
        dNSHostName            = (& $g 'dnshostname')
        operatingSystem        = (& $g 'operatingsystem')
        operatingSystemVersion = (& $g 'operatingsystemversion')
        lastLogonTimestamp     = $ll
        whenCreated            = (& $g 'whencreated')
        distinguishedName      = (& $g 'distinguishedname')
        enabled                = (-not ($uac -band 0x2))   # bit 2 = ACCOUNTDISABLE
    }
}

# UTF-8 AVEC BOM : sans lui Excel ouvre les accents en mojibake sur un Windows FR.
$csv = $rows | ConvertTo-Csv -NoTypeInformation
[System.IO.File]::WriteAllLines($OutFile, $csv, (New-Object System.Text.UTF8Encoding $true))

Write-Host ''
Write-Host ('  ' + $rows.Count + ' ordinateurs exportes') -ForegroundColor Green
Write-Host ('  ' + $OutFile)
Write-Host ('  actifs (compte non desactive) : ' + ($rows | Where-Object { $_.enabled }).Count)
Write-Host ''
Write-Host '  Deposez ce fichier sur la page Assets > Reconciliation.'
```

- [ ] **Step 2: Vérifier le parsing et la pureté ASCII**

```bash
powershell -NoProfile -Command "$e=$null; [void][System.Management.Automation.Language.Parser]::ParseFile('tools/reconcile/Collect-ADComputers.ps1',[ref]$null,[ref]$e); \"parse-errors=$($e.Count)\""
```
Attendu : `parse-errors=0`

```bash
powershell -NoProfile -Command "((Get-Content 'tools/reconcile/Collect-ADComputers.ps1' -Raw).ToCharArray() | Where-Object { [int]$_ -gt 127 }).Count"
```
Attendu : `0`

- [ ] **Step 3: Commit**

```bash
git add tools/reconcile/Collect-ADComputers.ps1
git commit -m "feat(reconcile): AD computer collector via DirectorySearcher, no RSAT needed"
```

- [ ] **Step 4: GATE — faire tourner le script et récupérer l'entête réelle**

Livrer le script à l'opérateur, le faire exécuter, récupérer les 5 premières lignes du CSV. **La tâche 4 est bloquée tant que cet échantillon n'existe pas.** Les tâches 2, 3, 5 n'en dépendent pas et peuvent avancer.

---

## Task 2 : `assetNameParser` — la carte apprise

**Files:**
- Create: `services/assetNameParser.js`
- Test: `tests/asset-name-parser.test.js`

- [ ] **Step 1: Écrire le test qui échoue**

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { learnPrefixMap, parseAssetName, HEAD_MIN } = require('../services/assetNameParser');

// Extrait mesure du parc reel (docs/.../2026-07-23-assets-reconciliation-design.md §2.1).
const ESTATE = [
  ...Array(5).fill({ asset_name: 'HGO-LAP-645', site: 'HOUNDE' }),
  ...Array(4).fill({ asset_name: 'HGO-DSK-604', site: 'HOUNDE' }),
  ...Array(5).fill({ asset_name: 'EDVSABWS281033', site: 'Sabodala' }),
  ...Array(3).fill({ asset_name: 'TGZSABWS408047', site: 'Sabodala' }),
  ...Array(4).fill({ asset_name: 'BFLTP440', site: 'MANA' }),
  { asset_name: 'FGT-MANA-300d-2.edv-ops.com', site: 'MANA' },   // tete unique
];

test('la tete alphabetique ignore les separateurs et les chiffres', () => {
  const m = learnPrefixMap(ESTATE);
  assert.ok(m.has('HGOLAP'), 'HGO-LAP-645 -> HGOLAP');
  assert.ok(m.has('EDVSABWS'), 'EDVSABWS281033 -> EDVSABWS');
});

test('deux eres du meme site restent deux tetes pointant vers le meme site', () => {
  const m = learnPrefixMap(ESTATE);
  assert.strictEqual(m.get('EDVSABWS').site, 'Sabodala');
  assert.strictEqual(m.get('TGZSABWS').site, 'Sabodala');
});

test('la purete est remontee, pas seulement le site dominant', () => {
  const mixed = [
    ...Array(7).fill({ asset_name: 'EDVDKRLT201001', site: 'Sabodala' }),
    ...Array(2).fill({ asset_name: 'EDVDKRLT201002', site: 'Dakar' }),
  ];
  const m = learnPrefixMap(mixed);
  const e = m.get('EDVDKRLT');
  assert.strictEqual(e.site, 'Sabodala');
  assert.ok(e.purity > 0.7 && e.purity < 0.8, 'purete ~78%, exposee et non arrondie a 100%');
});

// LE test qui protege la promesse du module : ne JAMAIS inventer un site.
test('une tete portant moins de HEAD_MIN machines n attribue aucun site', () => {
  const m = learnPrefixMap(ESTATE);
  const r = parseAssetName('FGT-MANA-999', m);
  assert.strictEqual(r.site, null, 'site indetermine, pas une supposition');
  assert.strictEqual(r.reason, 'head_too_rare');
});

test('un nom inconnu rend site null sans lever', () => {
  const m = learnPrefixMap(ESTATE);
  assert.strictEqual(parseAssetName('WORKGROUP-PC', m).site, null);
  assert.strictEqual(parseAssetName('', m).site, null);
  assert.strictEqual(parseAssetName(null, m).site, null);
});

test('le jeton de type est extrait quand il est reconnaissable', () => {
  const m = learnPrefixMap(ESTATE);
  assert.strictEqual(parseAssetName('HGO-LAP-999', m).typeToken, 'LAP');
  assert.strictEqual(parseAssetName('EDVSABWS999999', m).typeToken, 'WS');
});
```

- [ ] **Step 2: Lancer, vérifier l'échec**

```bash
node --test --test-force-exit tests/asset-name-parser.test.js
```
Attendu : ÉCHEC — `Cannot find module '../services/assetNameParser'`

- [ ] **Step 3: Implémenter**

```javascript
'use strict';
/**
 * assetNameParser - attribue un site et un jeton de type a un nom de machine,
 * a partir d'une carte APPRISE sur les actifs SDP.
 *
 * Pourquoi apprise et non configuree : le parc porte cinq graphies de
 * "portable" (LAP, LTOP, LPT, LTP, LT), deux prefixes pour Hounde (HGO, HND) et
 * deux eres pour Sabodala (TGZSAB, EDVSAB). Un dictionnaire ecrit a la main
 * deriverait des le mois suivant ; la carte apprise se met a jour seule quand
 * SDP grandit. Mesure : 89% du parc tombe dans une tete portant >= 3 machines.
 *
 * PUR - aucune base de donnees, aucune horloge.
 */

// Une tete portant moins de 3 machines ne suffit pas a attribuer un site :
// elle pourrait etre une machine unique mal nommee. Sous ce seuil on rend
// null et l'appelant affiche "site indetermine" - jamais une supposition.
const HEAD_MIN = 3;

// Jetons de type mesures sur le parc. Sert a l'indice de type, PAS au site.
const TYPE_TOKENS = ['LTOP', 'LPT', 'LTP', 'LAP', 'DESK', 'DSK', 'SRV', 'VM', 'WS', 'SW', 'AP', 'FW', 'LT'];

/** Tete alphabetique : tout ce qui precede le premier chiffre, separateurs otes. */
function head(name) {
  const s = String(name == null ? '' : name).trim().toUpperCase();
  const m = /^([A-Z\-_ .]+)/.exec(s);
  if (!m) return null;
  const h = m[1].replace(/[-_ .]/g, '');
  return h.length >= 2 ? h : null;
}

/** rows: [{asset_name, site}] -> Map(head -> {site, purity, n}) */
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
    let best = null, bestN = 0;
    for (const [s, n] of g.sites) if (n > bestN) { best = s; bestN = n; }
    out.set(h, { site: best, purity: bestN / g.n, n: g.n });
  }
  return out;
}

/** Le plus LONG jeton correspondant gagne : LTOP avant LT, sinon LT rafle tout. */
function typeToken(name) {
  const s = String(name == null ? '' : name).toUpperCase();
  for (const t of TYPE_TOKENS) {
    if (new RegExp('[-_](' + t + ')(?![A-Z])').test(s)) return t;
    if (new RegExp('(' + t + ')[0-9]').test(s)) return t;
  }
  return null;
}

/** -> {site, purity, typeToken, head, reason} ; site null = indetermine */
function parseAssetName(name, prefixMap) {
  const h = head(name);
  const tok = typeToken(name);
  if (!h) return { site: null, purity: 0, typeToken: tok, head: null, reason: 'no_head' };
  const e = prefixMap && prefixMap.get ? prefixMap.get(h) : null;
  if (!e) return { site: null, purity: 0, typeToken: tok, head: h, reason: 'head_unknown' };
  if (e.n < HEAD_MIN) return { site: null, purity: 0, typeToken: tok, head: h, reason: 'head_too_rare' };
  return { site: e.site, purity: e.purity, typeToken: tok, head: h, reason: 'ok' };
}

module.exports = { learnPrefixMap, parseAssetName, head, typeToken, HEAD_MIN, TYPE_TOKENS };
```

- [ ] **Step 4: Lancer, vérifier le succès**

```bash
node --test --test-force-exit tests/asset-name-parser.test.js
```
Attendu : `pass 6  fail 0`

- [ ] **Step 5: Commit**

```bash
git add services/assetNameParser.js tests/asset-name-parser.test.js
git commit -m "feat(reconcile): learned prefix map - site from hostname, purity exposed"
```

---

## Task 3 : `assetTypeClassifier` — la cascade

**Files:**
- Create: `services/assetTypeClassifier.js`
- Test: `tests/asset-type-classifier.test.js`

- [ ] **Step 1: Écrire le test qui échoue**

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { classifyType, TYPES } = require('../services/assetTypeClassifier');

test('product_type specifique gagne - SDP est autoritaire sur le reseau', () => {
  const r = classifyType({ product_type: 'Cisco Switch', product: 'Cisco Meraki MS120-8FP' });
  assert.strictEqual(r.type, TYPES.SWITCH);
  assert.strictEqual(r.source, 'product_type');
});

test('product_type generique est ignore au profit du modele', () => {
  // 2000+ actifs sont "Computer" : SDP ne distingue pas portable et fixe.
  const r = classifyType({ product_type: 'Computer', product: 'Latitude 5440' });
  assert.strictEqual(r.type, TYPES.LAPTOP);
  assert.strictEqual(r.source, 'product');
});

// L'ORDRE des regles est significatif : "Tower" doit gagner avant que la regle
// Precision-mobile ne reclame la machine.
test('Precision Tower 3620 est un fixe, pas un portable', () => {
  assert.strictEqual(classifyType({ product_type: 'Computer', product: 'Precision Tower 3620' }).type, TYPES.DESKTOP);
  assert.strictEqual(classifyType({ product_type: 'Computer', product: 'Precision 7680' }).type, TYPES.LAPTOP);
});

test('virtuel et physique sont distingues', () => {
  assert.strictEqual(classifyType({ product: 'VMware20,1' }).type, TYPES.VM);
  assert.strictEqual(classifyType({ product: 'ProLiant DL380 Gen9' }).type, TYPES.SERVER);
});

test('le nom prend le relais quand il n y a pas de modele', () => {
  const r = classifyType({ asset_name: 'HGO-SRV-01' });
  assert.strictEqual(r.type, TYPES.SERVER);
  assert.strictEqual(r.source, 'name');
});

// Le cas d'un ECART : ni product ni product_type, seulement AD/Entra.
test('l OS tranche serveur contre poste pour une machine absente de SDP', () => {
  assert.strictEqual(classifyType({ asset_name: 'SAB-NEW-01', os: 'Windows Server 2022' }).type, TYPES.SERVER);
  assert.strictEqual(classifyType({ asset_name: 'EDVSABLT409112', os: 'Windows 11 Pro' }).type, TYPES.LAPTOP);
});

test('vocabulaire canonique : jamais deux libelles pour une meme chose', () => {
  // "Laptop" (product_type de Londres) et "Portable" doivent se rejoindre,
  // sinon les filtres et les totaux se dedoublent.
  const a = classifyType({ product_type: 'Laptop' });
  const b = classifyType({ product_type: 'Computer', product: 'EliteBook 840' });
  assert.strictEqual(a.type, b.type);
  assert.ok(Object.values(TYPES).includes(a.type));
});

test('rien d exploitable -> null, jamais une supposition', () => {
  assert.strictEqual(classifyType({}).type, null);
});
```

- [ ] **Step 2: Lancer, vérifier l'échec**

```bash
node --test --test-force-exit tests/asset-type-classifier.test.js
```
Attendu : ÉCHEC — module introuvable

- [ ] **Step 3: Implémenter**

```javascript
'use strict';
/**
 * assetTypeClassifier - le type d'un equipement, par cascade a quatre sources
 * dans l'ordre de fiabilite MESURE sur le parc reel (spec §2) :
 *
 *   1. product_type quand il est SPECIFIQUE - SDP est autoritaire a 100% sur le
 *      reseau et les VM. Inutile uniquement sur son fourre-tout "Computer",
 *      qui ecrase 2000+ lignes.
 *   2. product (le modele) - classe 78% du parc a lui seul et separe virtuel de
 *      physique. Survit a un nom d'hote illisible ("5", hexadecimal).
 *   3. le nom - dernier recours interne.
 *   4. l'OS - la SEULE source disponible pour un ecart AD/Entra, ou ni product
 *      ni product_type n'existent.
 *
 * PUR. Tout resultat est normalise vers TYPES : faire confiance a product_type
 * verbatim importerait l'incoherence de SDP ("Laptop" a Londres, "Computer"
 * ailleurs) et dedoublerait filtres et totaux.
 */
const TYPES = {
  LAPTOP: 'Portable', DESKTOP: 'Fixe', SERVER: 'Serveur', VM: 'Serveur virtuel',
  SWITCH: 'Switch', AP: 'Point d acces', FIREWALL: 'Firewall', PRINTER: 'Imprimante', OTHER: 'Autre',
};

// product_type de SDP -> vocabulaire canonique. Ce qui n'est pas ici est generique.
const PT = [
  [/^cisco switch$|^switch$/i, TYPES.SWITCH],
  [/wireless access point|^access point$/i, TYPES.AP],
  [/wireless controller/i, TYPES.AP],
  [/^virtual machine$|^virtual host$/i, TYPES.VM],
  [/^firewall$/i, TYPES.FIREWALL],
  [/^printer$/i, TYPES.PRINTER],
  [/^laptop$|^notebook$/i, TYPES.LAPTOP],
  [/^desktop$|^workstation$/i, TYPES.DESKTOP],
  [/^server$/i, TYPES.SERVER],
];
const GENERIC_PT = /^(computer|unknown computer|)$/i;

// ORDRE SIGNIFICATIF. "Precision Tower 3620" doit heurter /tower/ avant que la
// regle Precision-mobile ne le reclame comme portable.
const MODEL = [
  [/vmware|virtual platform|hyper-?v|parallels|^virtual machine$/i, TYPES.VM],
  [/proliant|poweredge|thinksystem|primergy|blade/i,                TYPES.SERVER],
  [/meraki\s*mr|access point/i,                                     TYPES.AP],
  [/meraki\s*ms|catalyst|switch/i,                                  TYPES.SWITCH],
  [/fortigate|firewall|\bfgt\b/i,                                   TYPES.FIREWALL],
  [/tower|microtower|\bmt\b|\btwr\b|desktop|prodesk|elitedesk|optiplex|\bsff\b|all-?in-?one|mini\s*pc/i, TYPES.DESKTOP],
  [/latitude|probook|elitebook|zbook|notebook|\bxps\b|alienware|thinkpad|macbook|yoga|vostro|inspiron|surface\s*pro|mobile workstation|toughbook|\bfz\d/i, TYPES.LAPTOP],
  [/precision\s*7\d{3}|dell pro \d+/i,                              TYPES.LAPTOP],
];

const NAME = [
  [/[-_](SRV|SQL)(?![A-Z])|SRV[0-9]/i, TYPES.SERVER],
  [/[-_](LTOP|LPT|LTP|LAP|LT)(?![A-Z])|(LTOP|LPT|LTP|LAP)[0-9]/i, TYPES.LAPTOP],
  [/[-_](DSK|DESK|WS)(?![A-Z])|(DSK|WS)[0-9]/i, TYPES.DESKTOP],
  [/[-_]SW(?![A-Z])/i, TYPES.SWITCH],
  [/[-_]AP(?![A-Z])/i, TYPES.AP],
];

function classifyType(row) {
  const r = row || {};
  const pt = String(r.product_type || '').trim();
  if (pt && !GENERIC_PT.test(pt)) {
    for (const [re, t] of PT) if (re.test(pt)) return { type: t, source: 'product_type' };
    return { type: TYPES.OTHER, source: 'product_type' };
  }
  const p = String(r.product || '').trim();
  if (p) for (const [re, t] of MODEL) if (re.test(p)) return { type: t, source: 'product' };
  const n = String(r.asset_name || r.device_name || '').trim();
  if (n) for (const [re, t] of NAME) if (re.test(n)) return { type: t, source: 'name' };
  // Seule source disponible pour un ecart : l'OS tranche serveur/poste.
  const os = String(r.os || r.operatingSystem || '').trim();
  if (/windows server/i.test(os)) return { type: TYPES.SERVER, source: 'os' };
  if (/windows (10|11)|macos|mac os/i.test(os)) return { type: TYPES.DESKTOP, source: 'os' };
  return { type: null, source: null };
}

module.exports = { classifyType, TYPES };
```

> **Note pour l'implémenteur** : le test `l OS tranche...` attend `LAPTOP` pour `EDVSABLT409112` + `Windows 11 Pro`. La règle NAME (`LT`) se déclenche avant l'OS et rend `Portable` — c'est le comportement voulu. Vérifier que l'ordre nom-puis-OS produit bien ce résultat ; si le test échoue, c'est la regex NAME qui doit être corrigée, pas le test.

- [ ] **Step 4: Lancer, vérifier le succès**

```bash
node --test --test-force-exit tests/asset-type-classifier.test.js
```
Attendu : `pass 8  fail 0`

- [ ] **Step 5: Commit**

```bash
git add services/assetTypeClassifier.js tests/asset-type-classifier.test.js
git commit -m "feat(reconcile): four-source type cascade, single canonical vocabulary"
```

---

## Task 4 : `reconcileImport` — parser AD + Entra

> **Bloqué par la tâche 1 step 4.** Les noms de colonnes AD viennent de l'échantillon réel.

**Files:**
- Create: `services/reconcileImport.js`
- Test: `tests/reconcile-import.test.js`
- Create: `tests/fixtures/reconcile/ad-sample.csv`, `tests/fixtures/reconcile/entra-sample.csv`

- [ ] **Step 1: Écrire le test qui échoue**

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseAdCsv, parseEntraCsv, MissingColumnError } = require('../services/reconcileImport');

// LA regle : lecture par NOM d'en-tete, jamais par position. L'operateur peut
// laisser toutes les colonnes du portail et dans n'importe quel ordre.
test('les colonnes sont lues par en-tete, dans le desordre', () => {
  const csv = 'operatingSystem,name,lastLogonTimestamp,enabled,distinguishedName\r\n'
            + 'Windows 11 Pro,HGO-LAP-645,2026-07-21T08:00:00Z,True,"CN=HGO-LAP-645,OU=Hounde,DC=edv-ops,DC=com"\r\n';
  const r = parseAdCsv(csv);
  assert.strictEqual(r.rows.length, 1);
  assert.strictEqual(r.rows[0].device_name, 'HGO-LAP-645');
  assert.strictEqual(r.rows[0].os, 'Windows 11 Pro');
  assert.strictEqual(r.rows[0].enabled, true);
  assert.strictEqual(r.rows[0].ou_dn, 'CN=HGO-LAP-645,OU=Hounde,DC=edv-ops,DC=com');
});

test('une colonne requise manquante est NOMMEE, pas signalee vaguement', () => {
  const csv = 'operatingSystem,enabled\r\nWindows 11 Pro,True\r\n';
  assert.throws(() => parseAdCsv(csv), (e) => e instanceof MissingColumnError && /name/.test(e.message));
});

test('le BOM UTF-8 en tete de fichier ne casse pas le premier en-tete', () => {
  // Meme piege que Assets.csv : non retire, columns['name'] est undefined et
  // TOUTES les lignes sont rejetees, en silence.
  const csv = '﻿name,operatingSystem,lastLogonTimestamp,enabled\r\nX1,Windows 11,2026-07-21T08:00:00Z,True\r\n';
  assert.strictEqual(parseAdCsv(csv).rows[0].device_name, 'X1');
});

test('Entra : trustType et derniere connexion sont lus', () => {
  const csv = 'displayName,accountEnabled,operatingSystem,trustType,approximateLastSignInDateTime\r\n'
            + 'EDVSABLT409112,true,Windows,Hybrid Azure AD joined,2026-07-21T06:12:00Z\r\n';
  const r = parseEntraCsv(csv);
  assert.strictEqual(r.rows[0].device_name, 'EDVSABLT409112');
  assert.strictEqual(r.rows[0].join_type, 'Hybrid Azure AD joined');
  assert.strictEqual(r.rows[0].enabled, true);
});

test('une colonne optionnelle absente ne fait pas echouer', () => {
  const csv = 'displayName,accountEnabled,operatingSystem,trustType,approximateLastSignInDateTime\r\n'
            + 'X,true,Windows,Azure AD joined,2026-07-21T06:12:00Z\r\n';
  assert.strictEqual(parseEntraCsv(csv).rows[0].model, null);
});
```

- [ ] **Step 2: Lancer, vérifier l'échec** — `node --test --test-force-exit tests/reconcile-import.test.js`

- [ ] **Step 3: Implémenter** `services/reconcileImport.js`

Points obligatoires :
- Retirer un BOM `﻿` initial **avant** de découper l'en-tête (même piège qu'`Assets.csv`).
- Correspondance d'en-tête **insensible à la casse et aux espaces**, avec alias (`trustType` ≡ `joinType`, `name` ≡ `cn`).
- `MissingColumnError` porte le **nom** de la colonne absente.
- Ne PAS convertir FILETIME ici : le collecteur l'a déjà fait. Si un CSV contient malgré tout un entier à 18 chiffres, le convertir et **journaliser un avertissement**.
- Sortie normalisée commune aux deux sources : `{source, device_name, dns_name, os, os_version, last_seen, enabled, join_type, ou_dn, model, raw}`.

- [ ] **Step 4: Lancer, vérifier le succès** — attendu `pass 5  fail 0`

- [ ] **Step 5: Commit**

```bash
git add services/reconcileImport.js tests/reconcile-import.test.js tests/fixtures/reconcile/
git commit -m "feat(reconcile): header-driven CSV parsers for AD and Entra, BOM-safe"
```

---

## Task 5 : `reconcileAssets` — la comparaison

**Files:**
- Create: `services/reconcileAssets.js`
- Test: `tests/reconcile-assets.test.js`

- [ ] **Step 1: Écrire le test qui échoue**

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { normaliseKey, dedupeBySource, reconcile } = require('../services/reconcileAssets');

// LA jointure. Rien en aval ne rattrape une cle fausse.
test('trois formes du meme nom donnent une seule cle', () => {
  assert.strictEqual(normaliseKey('EDVSABLT409112'), 'EDVSABLT409112');
  assert.strictEqual(normaliseKey('edvsablt409112.edv-ops.com'), 'EDVSABLT409112');
  assert.strictEqual(normaliseKey('EDVSABLT409112$'), 'EDVSABLT409112');
  assert.strictEqual(normaliseKey('  edvsablt409112  '), 'EDVSABLT409112');
});

// 21 413 lignes Entra ne sont pas 21 413 machines : une machine reenregistree
// apparait plusieurs fois. Sans dedup, le compteur d'ecarts gonfle sans qu'une
// seule machine supplementaire n'existe.
test('la dedup garde la ligne la plus recente par cle et par source', () => {
  const rows = [
    { source: 'entra', device_name: 'PC1', last_seen: '2026-01-01T00:00:00Z' },
    { source: 'entra', device_name: 'pc1', last_seen: '2026-07-20T00:00:00Z' },
    { source: 'ad',    device_name: 'PC1', last_seen: '2026-03-01T00:00:00Z' },
  ];
  const out = dedupeBySource(rows);
  assert.strictEqual(out.length, 2, 'une par source, pas une par ligne');
  assert.strictEqual(out.find((r) => r.source === 'entra').last_seen, '2026-07-20T00:00:00Z');
});

test('un ecart = vu recemment ailleurs, absent de SDP', () => {
  const sdp = [{ asset_name: 'HGO-LAP-001', site: 'HOUNDE' }];
  const ext = [
    { source: 'ad', device_name: 'HGO-LAP-001', last_seen: '2026-07-22T00:00:00Z', enabled: true },
    { source: 'ad', device_name: 'HGO-LAP-999', last_seen: '2026-07-22T00:00:00Z', enabled: true },
  ];
  const r = reconcile({ sdpAssets: sdp, externalDevices: ext, asOf: '2026-07-23', recentDays: 30 });
  assert.deepStrictEqual(r.gaps.map((g) => g.device_name), ['HGO-LAP-999']);
});

test('une machine ancienne ou desactivee n est pas un ecart', () => {
  const ext = [
    { source: 'ad', device_name: 'OLD-1', last_seen: '2025-01-01T00:00:00Z', enabled: true },
    { source: 'ad', device_name: 'OFF-1', last_seen: '2026-07-22T00:00:00Z', enabled: false },
  ];
  const r = reconcile({ sdpAssets: [], externalDevices: ext, asOf: '2026-07-23', recentDays: 30 });
  assert.strictEqual(r.gaps.length, 0);
  assert.strictEqual(r.excluded.stale, 1);
  assert.strictEqual(r.excluded.disabled, 1);
});

// La ventilation des exclusions est aussi importante que le resultat : sans
// elle, personne ne fera confiance au chiffre retenu.
test('les exclusions sont ventilees par motif', () => {
  const r = reconcile({ sdpAssets: [], externalDevices: [], asOf: '2026-07-23', recentDays: 30 });
  assert.deepStrictEqual(Object.keys(r.excluded).sort(), ['disabled', 'no_date', 'stale']);
});

test('sens inverse : dans SDP, invisible ailleurs depuis 90 j', () => {
  const sdp = [{ asset_name: 'GONE-1', site: 'ITY' }, { asset_name: 'HERE-1', site: 'ITY' }];
  const ext = [{ source: 'ad', device_name: 'HERE-1', last_seen: '2026-07-22T00:00:00Z', enabled: true }];
  const r = reconcile({ sdpAssets: sdp, externalDevices: ext, asOf: '2026-07-23', recentDays: 30, staleDays: 90 });
  assert.deepStrictEqual(r.retirementCandidates.map((x) => x.asset_name), ['GONE-1']);
});

test('asOf est injecte - aucune horloge interne', () => {
  const ext = [{ source: 'ad', device_name: 'X', last_seen: '2026-06-01T00:00:00Z', enabled: true }];
  const a = reconcile({ sdpAssets: [], externalDevices: ext, asOf: '2026-06-10', recentDays: 30 });
  const b = reconcile({ sdpAssets: [], externalDevices: ext, asOf: '2026-09-10', recentDays: 30 });
  assert.strictEqual(a.gaps.length, 1);
  assert.strictEqual(b.gaps.length, 0);
});
```

- [ ] **Step 2: Lancer, vérifier l'échec**

- [ ] **Step 3: Implémenter** `services/reconcileAssets.js`

Points obligatoires :
- `normaliseKey` : majuscules → couper au premier `.` → retirer un `$` final → trim.
- `dedupeBySource` : `Map` clé `source|key`, garder `last_seen` max ; une date absente perd toujours.
- `asOf` **injecté**, jamais `new Date()` interne — sinon le rapport se re-date à chaque ouverture et le test devient impossible.
- `excluded` porte toujours ses trois clés, même à zéro : un objet dont les clés apparaissent et disparaissent casse l'affichage.
- Chaque écart porte `sources: ['ad','entra']` — vu par les deux est un signal plus fort.

- [ ] **Step 4: Lancer, vérifier le succès** — attendu `pass 7  fail 0`

- [ ] **Step 5: Commit**

```bash
git add services/reconcileAssets.js tests/reconcile-assets.test.js
git commit -m "feat(reconcile): pure comparison - normalised key, per-source dedup, injected asOf"
```

---

## Task 6 : Tables + lecteurs double backend

**Files:**
- Modify: `db/postgres/assets/001_init.sql`
- Modify: `assets-db.js`
- Modify: `services/reportConfig.js`
- Test: `tests/reconcile-readers.test.js`

- [ ] **Step 1: Écrire le test qui échoue**

```javascript
test('replaceExternalDevices remplace la source ciblee et LAISSE l autre', () => {
  db.replaceExternalDevices('ad', [{ device_name: 'A1', last_seen: '2026-07-22' }]);
  db.replaceExternalDevices('entra', [{ device_name: 'E1', last_seen: '2026-07-22' }]);
  db.replaceExternalDevices('ad', [{ device_name: 'A2', last_seen: '2026-07-23' }]);
  const all = db.listExternalDevices();
  assert.deepStrictEqual(all.map((r) => r.device_name).sort(), ['A2', 'E1']);
});

test('setDecision est idempotent et impose un motif pour hors-perimetre', () => {
  db.setDecision('A1', 'out_of_scope', 'poste de pret', 'azize');
  db.setDecision('A1', 'out_of_scope', 'poste de pret', 'azize');
  assert.strictEqual(db.listDecisions().length, 1);
  assert.throws(() => db.setDecision('A2', 'out_of_scope', '', 'azize'), /motif/i);
});
```

- [ ] **Step 2: Lancer, vérifier l'échec**

- [ ] **Step 3: Implémenter**

Dans le **CREATE partagé** `db/postgres/assets/001_init.sql` — jamais un `ALTER` (sqlite n'a pas `ADD COLUMN IF NOT EXISTS`, le boot lèverait `duplicate column` sur toute base existante) :

```sql
CREATE TABLE IF NOT EXISTS asset_external_devices (
  source TEXT NOT NULL, device_key TEXT NOT NULL, device_name TEXT NOT NULL,
  dns_name TEXT, os TEXT, os_version TEXT, last_seen TEXT, enabled INTEGER DEFAULT 1,
  join_type TEXT, ou_dn TEXT, model TEXT, raw_json TEXT,
  import_id TEXT, imported_at TEXT,
  PRIMARY KEY (source, device_key)
);
CREATE INDEX IF NOT EXISTS idx_aed_name ON asset_external_devices(device_name);

CREATE TABLE IF NOT EXISTS asset_reconcile_decisions (
  device_key TEXT PRIMARY KEY, decision TEXT NOT NULL, reason TEXT,
  decided_by TEXT, decided_at TEXT
);
```

`replaceExternalDevices(source, rows)` : `DELETE WHERE source=?` puis insertion, **dans une seule transaction**. La suppression est portée par `source` — remplacer AD ne doit jamais toucher Entra.

Ajouter à `reportConfig.DEFAULTS` : `reconcile_recent_days: '30'`. **Sans cette entrée, `setConfig` filtre la clé sur `KEYS.includes(k)` et l'écriture de l'admin est silencieusement perdue.**

- [ ] **Step 4: Lancer les tests + await-precedence**

```bash
node --test --test-force-exit tests/reconcile-readers.test.js tests/await-precedence.test.js
```

- [ ] **Step 5: Commit**

```bash
git add db/postgres/assets/001_init.sql assets-db.js services/reportConfig.js tests/reconcile-readers.test.js
git commit -m "feat(reconcile): external-device + decision tables, per-source replace"
```

---

## Task 7 : Les routes

**Files:**
- Modify: `server.js` (après le bloc `/api/assets/progress/`)
- Test: `tests/reconcile-routes.smoke.test.js`

- [ ] **Step 1: Écrire le test qui échoue**

```javascript
test('sans session -> 401 ou 403', async () => { /* GET /api/assets/reconcile/summary */ });
test('non-admin sur import -> 403', async () => { /* POST .../import */ });
test('CSV invalide -> 400 avec la colonne nommee, jamais 500', async () => { /* POST .../preview */ });
test('le collecteur .ps1 est servi en text/plain avec un nom de fichier', async () => { /* GET .../collector.ps1 */ });
```

- [ ] **Step 2: Lancer, vérifier l'échec**

- [ ] **Step 3: Implémenter les 6 routes** (la 7ᵉ, `export-sdp.csv`, est hors périmètre)

```
GET  /api/assets/reconcile/collector.ps1   requireReportSession
GET  /api/assets/reconcile/summary         requireReportSession
GET  /api/assets/reconcile/gaps            requireReportSession
GET  /api/assets/reconcile/export.xlsx     requireReportSession
POST /api/assets/reconcile/preview         requireReportSession + requireAdmin
POST /api/assets/reconcile/import          requireReportSession + requireAdmin
POST /api/assets/reconcile/decision        requireReportSession   (éditeur)
```

Points obligatoires :
- Le corps CSV passe par un parseur **`express.raw`** dédié, monté **avant** le `express.json` global — même piège que l'import Réunions, sinon le corps est rejeté à 100 Ko.
- `MissingColumnError` → **400** portant le nom de la colonne. Jamais 500.
- `asOf` résolu **en haut du handler**, puis passé partout — le piège documenté de la dépréciation (`asOf` correct dans l'enveloppe de réponse, `undefined` passé au lecteur).
- Le `.ps1` est lu depuis `tools/reconcile/` et servi avec `Content-Disposition: attachment`.

- [ ] **Step 4: Lancer, vérifier le succès**

- [ ] **Step 5: Commit**

---

## Task 8 : Le 7ᵉ onglet

**Files:**
- Modify: `public/assets.html`

- [ ] **Step 1: Les QUATRE éditions coordonnées**

Ajouter un onglet impose quatre modifications, et en oublier une donne un onglet à moitié vivant :

1. le tableau `TABS` (= l'ensemble des ancres d'URL)
2. la table `PANE`
3. la table `inited`
4. le balisage bouton + section

- [ ] **Step 2: Implémenter `REC_PANE`**

`init(f)` / `refresh(f)` lisant `filters()` partagé. **Ids préfixés `rec-`**, canvas unique, `destroy()` avant tout re-rendu (sinon « Canvas already in use »).

Contenu : bandeau de fraîcheur des imports · tuiles (écarts, sites touchés, candidats au retrait) · écarts groupés par site, dépliables · bouton export Excel · dépôt des deux fichiers avec prévisualisation ventilée · sélecteur de décision par ligne.

**Pas de bouton « export SDP »** — la route n'existe pas.

- [ ] **Step 3: Vérifier en navigateur**

Les 7 onglets s'affichent, le filtre Site restreint la réconciliation, zéro erreur console, l'ancre `#reconcile` atterrit au bon endroit après rechargement.

- [ ] **Step 4: Commit**

---

## Task 9 : Le guide sur la page

**Files:**
- Modify: `public/assets.html`

- [ ] **Step 1:** Section repliable « 📘 Guide complet », en français, sur le modèle de `meetings-import.html` : à quoi sert la réconciliation, comment débloquer PowerShell (`Set-ExecutionPolicy -Scope Process Bypass`), où cliquer dans Entra, colonnes requises, sens de « site indéterminé », que faire d'un écart.

- [ ] **Step 2:** Feuille de style `@media print` — `Ctrl+P` produit un PDF A4 ne contenant que le guide.

- [ ] **Step 3:** Vérifier l'impression en navigateur.

- [ ] **Step 4: Commit**

---

## Task 10 : Régression, documentation, clôture

- [ ] **Step 1: Suite complète**

```bash
node --test --test-force-exit tests/asset*.test.js tests/reconcile*.test.js tests/await-precedence.test.js
```

- [ ] **Step 2: Vérifier l'absence de régression sur les suites voisines**

```bash
node --test --test-force-exit tests/assets*.test.js tests/site-report*.test.js
```

Les 3 échecs `exec-routes.smoke` (`pgDb not initialised`) sont **pré-existants** — le vérifier sur un arbre remisé avant de conclure quoi que ce soit.

- [ ] **Step 3: CLAUDE.md** — nouvelle section « Current state », plus les pièges nouveaux : la clé normalisée, la dédup par source, le seuil `HEAD_MIN`, `reconcile_recent_days` obligatoire dans `DEFAULTS`.

- [ ] **Step 4:** `superpowers:finishing-a-development-branch`

---

## Task 11 — BLOQUÉE : export au format d'import SDP

**Ne pas commencer sans un modèle d'export CSV réel de SDP.**

Le jeu de données est déjà calculé par `reconcileAssets` ; il ne manque que la correspondance des colonnes. Environ une demi-journée une fois l'échantillon fourni : une fonction pure `toSdpImportCsv(gaps, mapping)`, une route, un bouton.

**Deviner les colonnes est exclu** : un CSV mal formé échoue à l'import, ou crée des actifs malformés dans l'inventaire de production — précisément ce que cette fonctionnalité existe pour éviter.
