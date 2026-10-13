'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { filterSessions } = require('../src/sessions');

const now = new Date(2026, 9, 13, 14, 30).getTime();
const sessions = [
  { id: 'new-api', title: 'API migration', ts: new Date(2026, 9, 13, 9).getTime(), messages: [{ content: 'move endpoints' }] },
  { id: 'old-ui', title: 'Terminal polish', ts: new Date(2026, 9, 12, 18).getTime(), messages: [{ content: [{ type: 'text', text: 'add completion' }] }] },
  { id: 'broken', ts: 'unknown', messages: null },
];

test('filters sessions by case-insensitive title, id, and message text', () => {
  assert.deepEqual(filterSessions(sessions, 'api', now).map((s) => s.id), ['new-api']);
  assert.deepEqual(filterSessions(sessions, 'COMPLETION', now).map((s) => s.id), ['old-ui']);
  assert.deepEqual(filterSessions(sessions, 'old-ui', now).map((s) => s.id), ['old-ui']);
});

test('filters sessions by local calendar date keywords and N d', () => {
  assert.deepEqual(filterSessions(sessions, 'today', now).map((s) => s.id), ['new-api']);
  assert.deepEqual(filterSessions(sessions, 'yesterday', now).map((s) => s.id), ['old-ui']);
  assert.deepEqual(filterSessions(sessions, '2026-10-12', now).map((s) => s.id), ['old-ui']);
  assert.deepEqual(filterSessions(sessions, '1 d', now).map((s) => s.id), ['old-ui']);
});

test('keeps original order and does not mutate malformed input', () => {
  const before = JSON.stringify(sessions);
  assert.deepEqual(filterSessions(sessions, '', now).map((s) => s.id), ['new-api', 'old-ui', 'broken']);
  assert.equal(JSON.stringify(sessions), before);
  assert.deepEqual(filterSessions(null, 'anything', now), []);
});
