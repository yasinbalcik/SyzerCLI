'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { validateTodos, renderTodos, execute } = require('../src/tools');

const T = (c, s) => ({ content: c, status: s });
const call = (todos) => ({ id: '1', name: 'todo_write', arguments: JSON.stringify({ todos }) });
const sess = () => ({ cwd: process.cwd(), todos: [], settings: { hooks: {}, rules: [] }, perm: 'auto' });

test('validateTodos: geçerli liste kabul', () => {
  assert.ok(validateTodos([T('a', 'in_progress'), T('b', 'pending')]).list);
});
test('validateTodos: hatalar', () => {
  assert.match(validateTodos([]).error, /non-empty/);
  assert.match(validateTodos([T(' ', 'pending')]).error, /empty content/);
  assert.match(validateTodos([T('a', 'doing')]).error, /invalid status/);
  assert.match(validateTodos([T('a', 'in_progress'), T('A', 'pending')]).error, /duplicates/);
  assert.match(validateTodos([T('a', 'in_progress'), T('b', 'in_progress')]).error, /exactly one/);
  assert.match(validateTodos([T('a', 'pending'), T('b', 'completed')]).error, /No item is in_progress/);
});
test('validateTodos: hepsi completed serbest', () => {
  assert.ok(validateTodos([T('a', 'completed')]).list);
});
test('renderTodos compact: 3+ biten madde katlanır', () => {
  const l = [T('a', 'completed'), T('b', 'completed'), T('c', 'completed'), T('d', 'in_progress')];
  assert.strictEqual(renderTodos(l, true).split('\n').length, 2);
  assert.strictEqual(renderTodos(l).split('\n').length, 4);
});
test('todo_write: durum modele döner, hepsi bitince temizlenir', async () => {
  const s = sess();
  let r = await execute(call([T('a', 'completed'), T('b', 'in_progress'), T('c', 'pending')]), s);
  assert.ok(r.ok); assert.match(r.output, /1\/3 done, now: "b"/); assert.strictEqual(s.todos.length, 3);
  r = await execute(call([T('a', 'completed'), T('b', 'in_progress'), T('c', 'in_progress')]), s);
  assert.ok(!r.ok); assert.strictEqual(s.todos.length, 3); // hatalı çağrı listeyi bozmaz
  r = await execute(call([T('a', 'completed'), T('b', 'completed'), T('c', 'completed')]), s);
  assert.ok(r.ok); assert.match(r.output, /cleared/); assert.strictEqual(s.todos.length, 0);
});
test('alt ajan todo_write kullanamaz', async () => {
  const s = { ...sess(), allowedTools: new Set(['read_file']) };
  const r = await execute(call([T('a', 'in_progress')]), s);
  assert.ok(!r.ok); assert.match(r.output, /not available/);
});
