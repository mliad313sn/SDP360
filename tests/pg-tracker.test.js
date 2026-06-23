'use strict';
// Chunk 1 — PostgreSQL adapter + tracker.db cutover. TDD suite.
// Pure-unit tests run anywhere; DB-backed tests skip cleanly when Postgres is down.
const { test } = require('node:test');
const assert = require('node:assert');
const { _translate } = require('../services/pgDb');

test('translate: ? becomes $1..$N, quoted ? untouched', () => {
  assert.equal(_translate('SELECT * FROM t WHERE a=? AND b=?'),
                          'SELECT * FROM t WHERE a=$1 AND b=$2');
  assert.equal(_translate("SELECT '?' , a FROM t WHERE a=?"),
                          "SELECT '?' , a FROM t WHERE a=$1");
});
