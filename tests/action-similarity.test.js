'use strict';
// Pure near-duplicate detection for report action tasks. Powers the "this looks
// like an already-open action — link it?" guard (prong B). Validated on the REAL
// divergent strings from the Site Actions hub (Helix / MineArc / Radio / Setup).
const { test } = require('node:test');
const assert = require('node:assert');
const { normalizeTask, similarity, findBestMatch } = require('../public/lib/actionSimilarity.js');

test('normalizeTask folds accents/case, drops punctuation + stopwords', () => {
  assert.deepEqual(
    normalizeTask('Helix underground surveillance Software deployment (Outsource of the fiber connection)'),
    ['helix', 'underground', 'surveillance', 'software', 'deployment', 'outsource', 'fiber', 'connection']
  );
  // accents + FR stopwords
  assert.deepEqual(normalizeTask('Configuration réseau à la Mine de Massawa'),
    ['configuration', 'reseau', 'mine', 'massawa']);
});

test('identical re-types score 1.0', () => {
  assert.equal(similarity('MineArc server (VM, VLAN, DHCP Scope)', 'MineArc server (VM, VLAN, DHCP Scope)'), 1);
  assert.equal(similarity('Core network harmonization in Meraki', 'Core network harmonization in Meraki'), 1);
});

test('the divergent Helix variant scores above threshold', () => {
  const s = similarity(
    'Helix underground surveillance Software deployment (Outsource of the fiber connection)',
    'Helix underground surveillance software deployment');
  assert.ok(s >= 0.5, `expected >=0.5, got ${s}`);
});

test('slightly-reworded same action scores high', () => {
  const s = similarity(
    'Setup wireless interconnection between chenil and Admin',
    'Setup wireless interconnection between Chenil and Admin network');
  assert.ok(s >= 0.7, `expected >=0.7, got ${s}`);
});

test('genuinely different actions score low', () => {
  const s = similarity(
    'Radio Configuration – Hytera Security team - Radio upgrade',
    'PLC integration - Mana Plant/ Leachstar- Install VM server');
  assert.ok(s < 0.2, `expected <0.2, got ${s}`);
});

test('findBestMatch returns the best candidate above threshold, else null', () => {
  const candidates = [
    { uid: 'a', lineage: 'L1', task: 'Helix underground surveillance software deployment', week_label: 'W13 2026', status: 'on_hold' },
    { uid: 'b', lineage: 'L2', task: 'Radio configuration - Hytera Security team - Radio upgrade', week_label: 'W13 2026', status: 'open' },
  ];
  const hit = findBestMatch('Helix underground surveillance Software deployment (Outsource of the fiber connection)', candidates);
  assert.equal(hit.candidate.lineage, 'L1');
  assert.ok(hit.score >= 0.5);

  assert.equal(findBestMatch('Replace core switch stack in Sabodala datacenter', candidates), null);
});

test('findBestMatch excludes a given lineage (a row never matches its own ancestor)', () => {
  const candidates = [{ uid: 'a', lineage: 'L1', task: 'Helix underground surveillance software deployment', status: 'on_hold' }];
  assert.equal(
    findBestMatch('Helix underground surveillance software deployment', candidates, { excludeLineage: 'L1' }),
    null);
});

test('degenerate input is safe', () => {
  assert.equal(similarity('', 'anything'), 0);
  assert.equal(similarity('   ', ''), 0);
  assert.equal(findBestMatch('', [{ task: 'x' }]), null);
  assert.equal(findBestMatch('x', []), null);
  assert.equal(findBestMatch('x', null), null);
});
