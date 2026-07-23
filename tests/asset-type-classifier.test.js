'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { classifyType, TYPES } = require('../services/assetTypeClassifier');

test('product_type specifique gagne — SDP est autoritaire sur le reseau', () => {
  // Mesure : product_type vaut "Cisco Switch" a 100% de purete sur MNASWMK.
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
test('Precision Tower 3620 est un fixe, Precision 7680 un portable', () => {
  assert.strictEqual(classifyType({ product_type: 'Computer', product: 'Precision Tower 3620' }).type, TYPES.DESKTOP);
  assert.strictEqual(classifyType({ product_type: 'Computer', product: 'Precision 7680' }).type, TYPES.LAPTOP);
});

test('virtuel et physique sont distingues', () => {
  assert.strictEqual(classifyType({ product: 'VMware20,1' }).type, TYPES.VM);
  assert.strictEqual(classifyType({ product: 'VMware Virtual Platform' }).type, TYPES.VM);
  assert.strictEqual(classifyType({ product: 'Parallels ARM Virtual Machine' }).type, TYPES.VM);
  // Sans cette regle, HGO-ACRONIS-SRV | ProLiant DL380 Gen9 tombe en non-classe
  // et la distinction virtuel/physique demandee disparait.
  assert.strictEqual(classifyType({ product: 'ProLiant DL380 Gen9' }).type, TYPES.SERVER);
});

test('les modeles absents du premier jet sont couverts', () => {
  // Les 35 non-classes de la mesure initiale.
  for (const p of ['Yoga Pro 9 16IMH9', 'Vostro 3400', 'Inspiron 16 Plus 7620',
                   'Surface Pro 9', 'HP ZBook Fury G1i 16 inch Mobile Workstation PC', 'FZ55-1']) {
    assert.strictEqual(classifyType({ product: p }).type, TYPES.LAPTOP, p);
  }
});

// La symetrie du piege Precision Tower : "workstation" appartient a la regle
// fixe, mais "Mobile Workstation" est un portable. La regle mobile DOIT passer
// avant, sinon un ZBook Fury est classe fixe.
test('workstation fixe et mobile workstation ne se confondent pas', () => {
  assert.strictEqual(classifyType({ product: 'HP Z840 Workstation' }).type, TYPES.DESKTOP);
  assert.strictEqual(classifyType({ product: 'HP Z2 Tower G9 Workstation Desktop PC' }).type, TYPES.DESKTOP);
  assert.strictEqual(classifyType({ product: 'HP ZBook Fury G1i 16 inch Mobile Workstation PC' }).type, TYPES.LAPTOP);
});

test('le nom prend le relais quand il n y a pas de modele', () => {
  const r = classifyType({ asset_name: 'HGO-SRV-01' });
  assert.strictEqual(r.type, TYPES.SERVER);
  assert.strictEqual(r.source, 'name');
});

// Le cas d'un ECART : ni product ni product_type, seulement AD/Entra.
test('l OS tranche serveur contre poste pour une machine absente de SDP', () => {
  const s = classifyType({ device_name: 'SAB-NEW-01', os: 'Windows Server 2022' });
  assert.strictEqual(s.type, TYPES.SERVER);
  assert.strictEqual(s.source, 'os');
  // Ici le NOM porte deja le jeton LT : il gagne avant l'OS, et c'est voulu —
  // il est plus precis (portable) que ce que l'OS pourrait dire (poste).
  const l = classifyType({ device_name: 'EDVSABLT409112', os: 'Windows 11 Pro' });
  assert.strictEqual(l.type, TYPES.LAPTOP);
  assert.strictEqual(l.source, 'name');
});

test('un nom sans jeton retombe sur l OS', () => {
  const r = classifyType({ device_name: 'WORKGROUP-PC', os: 'Windows 11 Pro' });
  assert.strictEqual(r.type, TYPES.DESKTOP);
  assert.strictEqual(r.source, 'os');
});

test('vocabulaire canonique : jamais deux libelles pour une meme chose', () => {
  // "Laptop" (product_type de Londres) et le resultat du modele doivent se
  // rejoindre, sinon filtres et totaux se dedoublent.
  const a = classifyType({ product_type: 'Laptop' });
  const b = classifyType({ product_type: 'Computer', product: 'HP EliteBook 840 G8 Notebook PC' });
  assert.strictEqual(a.type, b.type);
  const known = Object.values(TYPES);
  assert.ok(known.includes(a.type));
  // Aucun libelle de SDP ne doit fuir tel quel dans la sortie.
  assert.ok(!known.includes('Cisco Switch'));
  assert.ok(!known.includes('Computer'));
});

test('rien d exploitable -> null, jamais une supposition', () => {
  assert.strictEqual(classifyType({}).type, null);
  assert.strictEqual(classifyType({ product_type: 'Computer' }).type, null);
  assert.strictEqual(classifyType(null).type, null);
});
