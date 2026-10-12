'use strict';

const test = require('node:test');
const assert = require('node:assert');
const R = require('../src/routing');

const cfg = (routing, extra = {}) => ({ model: 'main/m', subagentModel: null, routing, ...extra });
const bad = (r) => !r.ok || !String(r.output || '').trim() || r.output === '(no output)';

test('resolve: precedence env > config > default', () => {
  const c = cfg({ explore: 'cfg/explore' });
  assert.deepStrictEqual(R.resolve('explore', c, {}), { model: 'cfg/explore', source: 'config' });
  assert.deepStrictEqual(R.resolve('explore', c, { SYZER_ROUTE_EXPLORE: 'env/x' }), { model: 'env/x', source: 'env' });
  assert.deepStrictEqual(R.resolve('edit', c, {}), { model: 'main/m', source: 'default' });
  assert.deepStrictEqual(R.resolve('summarize', c, {}), { model: 'main/m', source: 'default' });
  assert.deepStrictEqual(R.resolve('summarize', cfg({}, { subagentModel: 'cheap/s' }), {}), { model: 'cheap/s', source: 'default' });
  assert.strictEqual(R.resolve('explore', cfg(null, { subagentModel: 'cheap/s' }), {}).model, 'cheap/s');
});

test('explicit: unset role keeps existing behaviour', () => {
  assert.strictEqual(R.explicit('edit', cfg({}), {}), null);
  assert.strictEqual(R.explicit('edit', cfg(undefined), {}), null);
  assert.strictEqual(R.explicit('plan', cfg({ plan: '  ' }), {}), null);
});

test('roleForAgent / subagentRoute', () => {
  const ro = ['read_file', 'list_dir', 'search_files'];
  assert.strictEqual(R.roleForAgent({ name: 'explore', tools: ro }, false), 'explore');
  assert.strictEqual(R.roleForAgent({ name: 'custom', tools: ro }, false), 'explore');
  assert.strictEqual(R.roleForAgent({ name: 'plan', tools: ro }, false), 'explore' /* salt-okunur araçlar */);
  assert.strictEqual(R.roleForAgent({ name: 'plan', tools: [...ro, 'write_file'] }, false), 'plan');
  assert.strictEqual(R.roleForAgent({ name: 'general', tools: [...ro, 'write_file'] }, false), 'edit');
  assert.strictEqual(R.roleForAgent({ name: 'general', tools: [...ro, 'write_file'] }, true), 'explore');
  const c = cfg({ explore: 'cheap/e' });
  assert.deepStrictEqual(R.subagentRoute({ name: 'general', tools: ['write_file'] }, true, c, {}), { role: 'explore', model: 'cheap/e', source: 'config' });
  assert.strictEqual(R.subagentRoute({ name: 'general', tools: ['write_file'] }, false, c, {}), null); // edit ayarsız
});

test('shouldEscalate: only after two bad results, once, with routed cheap model', () => {
  const base = { enabled: true, first: { ok: false, output: 'x' }, second: { ok: true, output: '' }, used: 'cheap/e', target: 'main/m', routedRole: 'explore', done: false };
  assert.strictEqual(R.shouldEscalate(base, bad), true);
  assert.strictEqual(R.shouldEscalate({ ...base, enabled: false }, bad), false);
  assert.strictEqual(R.shouldEscalate({ ...base, done: true }, bad), false);
  assert.strictEqual(R.shouldEscalate({ ...base, routedRole: null }, bad), false);
  assert.strictEqual(R.shouldEscalate({ ...base, used: 'main/m' }, bad), false);
  assert.strictEqual(R.shouldEscalate({ ...base, second: { ok: true, output: 'fine report' } }, bad), false);
});

test('validate: unknown role, bad value, unknown model warns but is kept', () => {
  assert.deepStrictEqual(R.validate(null).warnings, []);
  assert.strictEqual(R.validate({ nope: 'a' }).warnings.length, 1);
  assert.strictEqual(R.validate({ explore: 5 }).warnings.length, 1);
  assert.strictEqual(R.validate({ escalate: 'yes' }).warnings.length, 1);
  assert.strictEqual(R.validate({ explore: 'a/b' }, ['a/b']).warnings.length, 0);
  assert.strictEqual(R.validate({ explore: 'new/model' }, ['a/b']).warnings.length, 1);
  assert.strictEqual(R.validate({ explore: 'new/model' }, null).warnings.length, 0);
  assert.deepStrictEqual(R.normalize({ explore: ' a ', bogus: 1, escalate: true }), { explore: 'a', escalate: true });
});
