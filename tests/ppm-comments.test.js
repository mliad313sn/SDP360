'use strict';
// PPM parity W4 — comments with @mentions (PURE): parsing, perimeter-only resolution, notices.
const { test } = require('node:test');
const assert = require('node:assert');
const CM = require('../services/ppm/comments');

test('body: trimmed, never empty, at most 4000 characters', () => {
  assert.equal(CM.normaliseBody('  hello \r\n'), 'hello');
  assert.throws(() => CM.normaliseBody('   '), (e) => e.reason === 'BODY_REQUIRED');
  assert.throws(() => CM.normaliseBody('x'.repeat(4001)), (e) => e.reason === 'BODY_TOO_LONG');
});

test('mentions: @username tokens, de-duplicated, lower-cased, e-mails are not mentions, trailing dot trimmed', () => {
  assert.deepEqual(CM.parseMentions('ping @Ana.B and @bob. also @ana.b, mail ana@corp.com'), ['ana.b', 'bob']);
  assert.deepEqual(CM.parseMentions('no mention'), []);
  assert.equal(CM.parseMentions(Array.from({ length: 30 }, (_, i) => '@u' + i).join(' ')).length, CM.MAX_MENTIONS);
});

test('resolution: only ACTIVE accounts that may READ the project; the rest is "unresolved" without saying why', () => {
  const users = [{ id: 1, username: 'ana', full_name: 'Ana' }, { id: 2, username: 'bob' }, { id: 3, username: 'gone', active: 0 }];
  const r = CM.resolveMentions(['ana', 'bob', 'gone', 'ghost'], users, new Set([1, 3]));
  assert.deepEqual(r.mentioned, [{ id: 1, label: 'Ana' }]);
  assert.deepEqual(r.unresolved, ['bob', 'gone', 'ghost'], 'out of perimeter, inactive and unknown look the same');
});

test('notices: one per mentioned reader, never the author, link to the comments tab', () => {
  const n = CM.noticesFor({ id: 9, project_id: 4, task_id: 12, body: 'see this' }, [{ id: 1 }, { id: 2 }], { actorId: 2, authorName: 'Bob', projectKey: 'NET-1' });
  assert.equal(n.length, 1);
  assert.equal(n[0].userId, 1);
  assert.match(n[0].title, /Bob mentioned you on task #12 of project NET-1/);
  assert.equal(n[0].link, 'project.html?id=4#comments');
  assert.equal(n[0].sourceKind, 'ppm_comment');
});
