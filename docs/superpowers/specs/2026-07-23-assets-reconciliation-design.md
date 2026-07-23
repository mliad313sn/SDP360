# Réconciliation Assets — SDP × Active Directory × Entra ID

**Date** : 2026-07-23
**Module** : Assets (7ᵉ onglet)
**Statut** : spec approuvé sections 1-4, en attente de trois échantillons de données

---

## 1. Le problème

SelfScan est déployé par GPO. Il ne s'installe pas partout : un poste hors GPO, un
serveur oublié, une machine réimagée. Ces machines existent, se connectent, et
**sont invisibles pour SDP** — l'inventaire ne peut pas signaler ce qu'il ignore.

L'inventaire actuel a un angle mort exact : les six « kinds » d'hygiène
(`never_scanned`, `ghost`, `no_owner`…) ne parlent que des machines **que SDP
connaît déjà**. Aucun d'eux ne peut compter une machine jamais enregistrée.

AD et Entra, eux, les voient. La réconciliation consiste à comparer les trois
inventaires et à produire la liste actionnable des machines vues récemment
ailleurs mais absentes de SDP.

### Le chiffre qui a dicté la conception

Entra contient **21 413 appareils**. SDP en contient **2 478**. Un diff brut
produirait ~19 000 « écarts » : téléphones, BYOD « Entra registered »,
enregistrements morts depuis 2022. Une liste que personne n'ouvre deux fois.

**Le travail utile n'est pas la comparaison — elle est triviale. C'est le filtre.**

---

## 2. Mesures préalables (parc réel, 2 478 actifs)

Toutes les décisions ci-dessous sont mesurées, pas supposées.

### 2.1 Le nom de machine prédit le site de façon fiable

Deux vocabulaires coexistent : le nom d'hôte porte un code court, la colonne
`site` porte le nom de mine d'AssetExplorer.

| Tête alphabétique | N | Site (pureté) |
|---|---|---|
| `ITYLTOP` | 302 | ITY 99 % |
| `ABJLAP` | 203 | ABIDJAN 100 % |
| `HGODSK` | 187 | HOUNDE 100 % |
| `EDVSABWS` | 167 | Sabodala 99 % |
| `BFLTP` | 150 | **MANA** 99 % |
| `SMLLAP` | 148 | LAFIGUE 100 % |
| `TGZSABWS` | 63 | Sabodala 100 % |
| `EDVWENCOWS` | 5 | Sabodala 100 % |

**89 %** du parc tombe dans une tête portant ≥3 machines. La taxonomie confirmée :
`TGZSAB` (Teranga historique) et `EDVSAB` (Endeavour actuel) désignent le même
site ; `BF` résout vers MANA ; `WENCO` et `SMC` sont Sabodala.

**Deux anomalies détectées** :
- `EDVDKRLT` → Sabodala 78 %, `EDVDKRWS` → Dakar 67 %. Les machines « DKR » sont
  éclatées entre deux sites dans SDP.
- `HND-LAP-743` coexiste avec `HGO-LAP-*` : deux préfixes pour Hounde.

### 2.2 `product_type` est inutilisable pour les ordinateurs

SDP écrase 2 000+ lignes en `Computer`. Il est en revanche **fiable à 100 %** sur
le réseau (`Cisco Switch`, `Wireless Access Point`) et les VM (`Virtual Machine`).

### 2.3 `product` (le modèle) classe 78 % du parc à lui seul

367 valeurs distinctes, vocabulaire très régulier :
`Latitude`/`ProBook`/`EliteBook`/`XPS` → portable · `Tower`/`Microtower`/
`OptiPlex`/`ProDesk` → desktop · `VMware` → serveur virtuel · `Meraki MR` →
point d'accès · `Meraki MS`/`Catalyst` → switch.

Il survit à un nom d'hôte illisible : deux actifs s'appellent `5` et
`4D 4E 41 2D 53 57…` (hexadécimal) — `Cisco Meraki MR36` et `MS120-8FP` les
classent sans ambiguïté.

**C'est la seule source qui distingue virtuel de physique.**

---

## 3. Architecture

Trois couches, dont **une seule changera** quand on automatisera l'acquisition.

```
ACQUISITION            NORMALISATION              COMPARAISON          RESTITUTION
(remplaçable)          (le cœur)                  (pure)

Export Entra CSV  ─┐
                   ├─→ assetNameParser.js ──→ reconcileAssets.js ──→ onglet Réconciliation
Collect-AD.ps1    ─┘    assetTypeClassifier.js    gaps + inverse       + 2 exports
   ↑ plus tard :                                          ↑
   Graph /devices                              assets (SDP, déjà synchronisé)
```

Le moteur de comparaison ne connaît ni CSV ni Graph : il opère sur deux listes
en mémoire. Brancher Microsoft Graph plus tard ne touchera que la couche
d'acquisition.

### 3.1 `services/assetNameParser.js` — pur

Carte **apprise depuis SDP**, pas écrite à la main. Pour chaque tête
alphabétique du parc, le site dominant et sa pureté sont calculés à l'exécution.
Une machine absente de SDP est ensuite attribuée par sa tête.

Motif retenu, mesuré : `^([A-Z\-_ ]+)` — tout ce qui précède le premier chiffre,
séparateurs retirés. `HGO-LAP-01` → `HGOLAP` ; `TGZSABWS703009` → `TGZSABWS`.

**Pourquoi apprise et non configurée** : cinq graphies pour « portable » (`LAP`,
`LTOP`, `LPT`, `LTP`, `LT`), deux préfixes pour Hounde, deux ères pour Sabodala.
Un dictionnaire écrit à la main dériverait dès le mois suivant. La carte apprise
se met à jour seule quand SDP grandit.

**La pureté est un signal exposé, pas un détail interne.** `EDVDKRLT` sort à
« site probable Sabodala, confiance 78 % » plutôt qu'à une attribution
arbitraire.

**Seuil** : une tête portant <3 machines ne suffit pas à attribuer un site. Ces
machines apparaissent en **« site indéterminé »** — listées, jamais silencieusement
écartées. (246 têtes / 265 machines aujourd'hui, dont `FGT-MANA-300d`,
`SML-FS-01`.)

### 3.2 `services/assetTypeClassifier.js` — pur, cascade à trois sources

Ordre de confiance mesuré :

1. **`product_type` s'il est spécifique** — SDP est autoritaire sur le réseau et
   les VM. Ignoré quand il vaut `Computer` / `Unknown Computer` / vide.
2. **`product`** (modèle) — sépare portable / desktop / virtuel / physique.
3. **Le jeton du nom** — dernier recours.

Résultat mesuré sur le parc : **99 % classés** (78 % par `product`, 13 % par
`product_type`, 7 % par le nom, 1 % non classé).

**Vocabulaire canonique obligatoire.** Faire confiance à `product_type` verbatim
importe l'incohérence de SDP : le premier essai a produit *à la fois* « Portable »
et « Laptop », « Switch » et « Cisco Switch ». Tout résultat est normalisé vers un
seul jeu de libellés, sinon les filtres et les totaux se dédoublent.

**Serveur physique inclus** : `ProLiant`, `PowerEdge`, `ThinkSystem`, `PRIMERGY`.
Sans cette règle, `HGO-ACRONIS-SRV | ProLiant DL380 Gen9` tombe en « non classé »
et la distinction virtuel/physique demandée disparaît.

### 3.3 Limite structurelle, à énoncer clairement

Le classificateur ci-dessus tourne sur des données **SDP**. Les machines
recherchées sont précisément **celles qui n'y sont pas** — ni `product` ni
`product_type` n'existent pour elles.

| Champ | AD | Entra |
|---|---|---|
| Nom | ✅ | ✅ |
| Système d'exploitation | ✅ | ✅ |
| Modèle | ❌ | ⚠️ parfois (`model`, `manufacturer`) |
| OU / rattachement | ✅ (`distinguishedName`) | ❌ |

Pour un écart, le type vient donc de **nom + OS** : `Windows Server *` tranche
serveur/poste, le nom tranche portable/fixe. Le modèle exact reste inconnu
jusqu'au passage de SelfScan — ce qui est cohérent, puisque c'est exactement ce
qu'on lui demande d'aller faire.

Le classificateur `product` reste à construire pour deux raisons : il enrichit
les 2 478 actifs existants (aujourd'hui indistinctement `Computer`), et il fournit
le référentiel qui permettra de comparer à l'identique quand la machine manquante
sera enfin scannée.

### 3.4 La jointure — la partie que rien ne rattrape si elle est fausse

Le nom est la seule clé commune aux trois systèmes. Trois formes différentes du
même nom circulent, et une comparaison naïve les traiterait comme trois machines
distinctes :

| Source | Champ | Forme observée |
|---|---|---|
| SDP | `asset_name` | `EDVSABLT409112` |
| AD | `name` / `dNSHostName` | `EDVSABLT409112` / `edvsablt409112.edv-ops.com` |
| Entra | `displayName` | `EDVSABLT409112` |

**Clé normalisée** : passage en majuscules, suppression du suffixe DNS après le
premier point, suppression d'un `$` final (forme compte-machine d'AD), espaces
retirés. `edvsablt409112.edv-ops.com` → `EDVSABLT409112`.

**Déduplication obligatoire côté source.** Une machine réenregistrée apparaît
plusieurs fois dans Entra sous le même `displayName` — 21 413 lignes n'égalent
pas 21 413 machines. On conserve, par clé normalisée et par source, **la ligne
dont l'activité est la plus récente**. Sans cela, le compteur d'écarts gonfle sans
qu'aucune machine supplémentaire n'existe.

**Limite acceptée** : une machine renommée depuis son dernier scan apparaît comme
un écart, et son ancien nom comme un candidat au retrait. Ni AD ni Entra ne
fournissent le numéro de série, donc aucune confirmation croisée n'est possible.
Le cas est rare et se résout au scan suivant ; le signaler vaut mieux que de
prétendre le résoudre.

### 3.5 Fraîcheur — un seuil, configurable

« Vue récemment » vaut **30 jours** par défaut, dans `reportConfig.DEFAULTS`
(`reconcile_recent_days`). Configurable parce qu'il n'existe pas de bonne valeur
universelle : un site à rotation lente voudra 60 jours, une campagne de
déploiement 7. La valeur retenue est affichée dans l'en-tête du rapport — un
seuil implicite rend deux rapports incomparables.

### 3.6 Persistance

Table `asset_external_devices` : le **dernier import par source**, pas
d'historique complet. Ce qui compte est « la photo AD d'aujourd'hui contre SDP
d'aujourd'hui ». Conserver l'import rend le rapport reproductible et permet
d'afficher *« AD importé le 23/07, 1 240 machines »* — sans quoi personne ne sait
sur quoi il regarde.

Colonnes : `source`, `device_name`, `dns_name`, `os`, `os_version`, `last_seen`,
`enabled`, `join_type`, `ou_dn`, `model`, `raw_json`, `import_id`, `imported_at`.

**Alternative écartée** : une page « déposer, voir, oublier ». Plus simple, mais
on ne peut ni citer la date de l'import en réunion, ni mesurer si l'écart se
résorbe d'un mois sur l'autre — or c'est précisément le levier recherché.

---

## 4. Le rapport

Un 7ᵉ onglet **« Réconciliation »** sur `assets.html`, à côté de Progress.

### 4.1 L'import prévisualise avant d'écrire

```
AD     ✔ 1 240 machines lues · 1 187 actives <30j · 53 écartées (compte désactivé)
Entra  ✔ 21 413 lues · 1 402 retenues · 20 011 écartées
       └ 14 890 sans nom d'entreprise · 3 902 mobiles · 1 219 inactives >30j
```

**La ventilation des exclusions est aussi importante que le résultat.** Sans elle,
personne ne fera confiance aux 1 402 retenues.

### 4.2 Groupé par site

Le site est l'unité d'action — un coordonnateur en possède un.

```
ÉCARTS — machines vues récemment, absentes de SDP          47
répartis sur 5 sites · import AD du 23/07, Entra du 23/07

SABODALA 18 ┃ ITY 12 ┃ HOUNDE 9 ┃ MANA 6 ┃ site indéterminé 2

▾ SABODALA (18)
  EDVSABLT409112   Portable   Windows 11 Pro        AD + Entra   vu il y a 2 j
  SAB-NEW-SRV02    Serveur    Windows Server 2022   AD           vu il y a 1 j
```

### 4.3 Deux exports

- **Fiche de travail** (Excel, par site) — à envoyer au coordonnateur.
- **CSV au format d'import SDP** — rechargeable via le bouton « Import from CSV »
  de la liste d'actifs. Les machines existent alors dans l'inventaire, SelfScan
  les enrichira au passage suivant.

⚠️ **Le format d'import SDP est inconnu et ne sera pas deviné.** Un échantillon est
requis avant d'implémenter cet export.

### 4.4 Le compteur doit pouvoir descendre

Sans état, les mêmes 47 machines reviennent chaque mois et la liste perd sa
crédibilité en deux itérations. Chaque écart accepte une décision, conservée par
nom dans `asset_reconcile_decisions` :

- **traité** — importé ou SelfScan relancé ; sort du compteur.
- **hors périmètre** — motif obligatoire (poste de prêt, machine de test, rebut) ;
  sort du compteur, reste consultable.

D'où le levier recherché : **l'écart par site, d'un import à l'autre**. Un site
qui passe de 18 à 4 se voit ; un site bloqué à 18 depuis trois mois aussi.

### 4.5 Le sens inverse, gratuit

Même jointure : les actifs présents dans SDP mais **absents d'AD et d'Entra depuis
90 jours**. Pendant du `ghost` existant, mais avec une preuve externe au lieu d'une
absence de scan — un `ghost` peut être une machine qui tourne sans agent,
celui-ci est probablement une machine qui n'existe plus.

### 4.6 Hors périmètre, volontairement

**Aucune écriture vers SDP depuis le tableau de bord.** Le module Assets est un
miroir en lecture seule ; lui donner un droit d'écriture ferait de nous une
seconde source de vérité sur l'inventaire. On produit le fichier, l'opérateur le
charge dans SDP.

---

## 5. La page comme outil de collecte

Patron repris de `meetings-import.html`, qui fait déjà exactement cela pour les
PV : télécharger, remplir, déposer, valider, guide complet sur la même page,
feuille de style d'impression.

### 5.1 Étape 1 — le script AD, servi par le tableau de bord

`GET /api/assets/reconcile/collector.ps1`, sous session — pas déposé en clair
dans `public/`.

**Le script n'utilise PAS `Get-ADComputer`.** Cette cmdlet exige RSAT, absent d'un
poste courant : le script échouerait chez la moitié des opérateurs. Il interroge
l'annuaire via `System.DirectoryServices.DirectorySearcher`, **présent nativement
sur tout Windows joint au domaine**. Aucune installation, **aucun droit
administrateur** — lire les objets ordinateur est un droit de tout compte du
domaine.

Champs collectés, et rien d'autre :

```
name · dNSHostName · operatingSystem · operatingSystemVersion
lastLogonTimestamp · whenCreated · distinguishedName · userAccountControl
```

`distinguishedName` porte l'OU — second indice de site, indépendant du nom.
`userAccountControl` donne le compte désactivé.

Sortie : CSV **UTF-8 avec BOM** (Excel ouvre les accents correctement) plus un
résumé à l'écran. **Une seule exécution couvre tout le domaine** — ce n'est pas
un script par site.

### 5.2 Étape 2 — Entra, colonnes minimales

Bouton « Download devices » du portail. L'import lit **par nom d'en-tête, jamais
par position** : les colonnes surnuméraires sont ignorées.

- **Requises** : `displayName`, `accountEnabled`, `operatingSystem`,
  `trustType` (ou `joinType`), `approximateLastSignInDateTime`
- **Utiles si présentes** : `model`, `manufacturer`, `deviceId`, `mdmDisplayName`

Une colonne requise manquante est signalée **avant** l'import, en la nommant.

### 5.3 Étapes 3-4 — déposer, prévisualiser, valider

Rien n'est écrit tant que la validation n'est pas confirmée.

### 5.4 Le guide, sur la même page

En français, replié : à quoi sert la réconciliation, comment débloquer PowerShell
(`Set-ExecutionPolicy -Scope Process Bypass`), où cliquer dans Entra, ce que
signifie « site indéterminé », que faire d'un écart. Feuille de style
d'impression : `Ctrl+P` produit un PDF A4 propre à envoyer aux coordonnateurs.

---

## 6. Surfaces

| Type | Élément |
|---|---|
| Service pur | `services/assetNameParser.js` |
| Service pur | `services/assetTypeClassifier.js` |
| Service pur | `services/reconcileAssets.js` |
| Parseur | `services/reconcileImport.js` (CSV AD + Entra, par en-tête) |
| Table | `asset_external_devices` |
| Table | `asset_reconcile_decisions` |
| Route | `GET /api/assets/reconcile/collector.ps1` |
| Route | `POST /api/assets/reconcile/preview` |
| Route | `POST /api/assets/reconcile/import` |
| Route | `GET /api/assets/reconcile/summary` |
| Route | `GET /api/assets/reconcile/gaps` |
| Route | `POST /api/assets/reconcile/decision` |
| Route | `GET /api/assets/reconcile/export.xlsx` |
| Route | `GET /api/assets/reconcile/export-sdp.csv` |
| UI | 7ᵉ onglet sur `public/assets.html` |
| Script | `tools/reconcile/Collect-ADComputers.ps1` |

Ajouter un 7ᵉ onglet impose les **quatre éditions coordonnées** documentées :
tableau `TABS`, table `PANE`, table `inited`, et le balisage bouton + section.

---

## 7. Droits

| Action | Rôle minimum | Raison |
|---|---|---|
| Voir le rapport, exporter | `requireReportSession` | même niveau que les autres onglets Assets |
| Télécharger le collecteur `.ps1` | `requireReportSession` | aucun secret, mais hors de portée anonyme |
| Prévisualiser un import | `requireAdmin` | lit un fichier fourni par l'opérateur |
| **Valider un import** | `requireAdmin` | remplace l'inventaire externe de référence |
| Poser une décision (traité / hors périmètre) | éditeur | geste de terrain, pas d'administration |

Un import remplace la photo de référence pour tout le monde : c'est une action
d'administration, pas un geste de coordonnateur. Poser une décision sur une
machine, en revanche, est exactement le travail qu'on cherche à provoquer chez le
coordonnateur — l'exiger d'un administrateur tuerait la boucle.

## 8. Tests

| Niveau | Ce qui est couvert |
|---|---|
| Pur, sans base | `assetNameParser` — apprentissage de la carte, seuil <3 machines → « indéterminé », pureté remontée, les deux dialectes (`HGO-LAP-01`, `BFDSK397`, `TGZSABWS703009`) |
| Pur, sans base | `assetTypeClassifier` — les trois sources dans l'ordre, `Precision Tower 3620` → Desktop et non Portable (l'ordre des règles compte), `ProLiant` → serveur physique, vocabulaire canonique sans doublon |
| Pur, sans base | `reconcileAssets` — écarts, sens inverse, clé normalisée (`edvsablt409112.edv-ops.com` == `EDVSABLT409112`), déduplication par activité la plus récente |
| Parseur | `reconcileImport` — lecture par en-tête et non par position, colonnes dans le désordre, colonne requise manquante nommée, `lastLogonTimestamp` FILETIME converti, BOM toléré |
| Lecteurs | double backend sqlite/pg, couverts par `await-precedence` |
| Route | smoke : sans session → 401/403, non-admin sur import → 403, format invalide → 400 jamais 500 |

**Fixture pinnée sur données réelles** : le parseur de noms est vérifié contre un
extrait anonymisé du parc, avec les chiffres mesurés dans ce document (89 % de
couverture, `EDVDKRLT` à 78 % de pureté). Une régression sur la carte apprise se
verrait immédiatement — c'est la pièce dont dépendent toutes les attributions.

## 9. Ce qui manque avant l'implémentation

| # | Échantillon | Bloque |
|---|---|---|
| 1 | Un export produit par `Collect-ADComputers.ps1` | le calage des colonnes AD |
| 2 | 20 lignes d'un export Entra du tenant | le calage des colonnes Entra |
| 3 | Le modèle d'import CSV de SDP | **l'export réinjectable en entier** |

Seul le troisième bloque une fonctionnalité complète. Les deux premiers ne
bloquent qu'un calage de noms de colonnes, et le script peut être livré en premier
pour produire l'échantillon 1.

---

## 10. Pièges connus, à respecter

- **`_assetWhere` renvoie `' AND a.<col> = ?'`** — toute requête sur `assets` doit
  être `FROM assets a WHERE 1=1${_assetWhere(f)}`.
- **Ne jamais inverser `ALIAS`** — ses clés sont des clés de recherche repliées,
  pas des orthographes de base. Replier vers l'avant depuis
  `getAssetLookups().sites`.
- **Aucun `CAST` SQL sur une colonne TEXT numérique** — sqlite est laxiste, pg
  lève une 500. Coercition en JS.
- **`null` ≠ `0`** — une attribution de site absente est `null` (non mesurée), pas
  une chaîne vide qui passerait pour un site connu.
- **Les dates Entra sont ISO-8601 avec fuseau** ; `lastLogonTimestamp` d'AD est un
  entier FILETIME 64 bits à convertir, **pas** une date.
