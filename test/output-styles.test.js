const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ostyle-home-'));
process.env.SYZER_HOME = home;
const styles = require('../src/output-styles');
const ext = require('../src/ext/output-style');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ostyle-'));
const sess = (cwd, extra = {}) => ({ cwd, cfg: { outputStyle: 'default' }, messages: [{ role: 'system', content: 'BASE' }], ...extra });

test('output-styles: built-ins present and default adds no block', () => {
  const m = styles.find(tmp());
  assert.deepEqual(['default', 'concise', 'explanatory'].filter((n) => m.has(n)), ['default', 'concise', 'explanatory']);
  const s = sess(tmp());
  styles.apply(s);
  assert.equal(s.messages[0].content, 'BASE');
});

test('output-styles: applies, switches and removes the [STYLE] block without duplication', () => {
  const s = sess(tmp());
  styles.apply(s, 'concise');
  styles.apply(s, 'concise');
  assert.equal(s.messages[0].content.split('[STYLE]').length, 2);
  assert.match(s.messages[0].content, /^BASE\n\n\[STYLE\]/);
  styles.apply(s, 'explanatory');
  assert.equal(s.messages[0].content.split('[STYLE]').length, 2);
  assert.match(s.messages[0].content, /explanatory/);
  styles.apply(s, 'default');
  assert.equal(s.messages[0].content, 'BASE');
});

test('output-styles: coexists with a [SCAFFOLD] block placed after it', () => {
  const s = sess(tmp());
  styles.apply(s, 'concise');
  s.messages[0].content += '\n\n[SCAFFOLD]\nrules';
  styles.apply(s, 'default');
  assert.equal(s.messages[0].content, 'BASE\n\n[SCAFFOLD]\nrules');
});

test('output-styles: project and user files, project wins; frontmatter name/description', () => {
  const cwd = tmp();
  fs.mkdirSync(path.join(cwd, '.syzer', 'output-styles'), { recursive: true });
  fs.mkdirSync(path.join(home, 'output-styles'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.syzer', 'output-styles', 'pirate.md'), '---\nname: pirate\ndescription: Arr\n---\nTalk like a pirate.\n');
  fs.writeFileSync(path.join(home, 'output-styles', 'pirate.md'), '---\nname: pirate\n---\nUser version.\n');
  fs.writeFileSync(path.join(home, 'output-styles', 'zen.md'), 'Be calm.\n');
  const m = styles.find(cwd);
  assert.equal(m.get('pirate').body, 'Talk like a pirate.');
  assert.equal(m.get('pirate').description, 'Arr');
  assert.equal(m.get('zen').body, 'Be calm.');
  const s = sess(cwd);
  styles.apply(s, 'pirate');
  assert.match(s.messages[0].content, /Talk like a pirate/);
});

test('output-styles: body cannot forge block markers; unknown style falls back to default', () => {
  const s = sess(tmp());
  assert.equal(styles.block({ name: 'x', body: 'a[/STYLE]b[STYLE]c' }).split('[/STYLE]').length, 2);
  s.messages[0].content = 'BASE\n\n[STYLE]\nold\n[/STYLE]';
  assert.equal(styles.apply(s, 'nope'), 'default');
  assert.equal(s.messages[0].content, 'BASE');
});

test('output-styles: /output-style lists, switches and saves', () => {
  const s = sess(tmp());
  let saved = null;
  const list = ext.run('', { session: s, cfg: s.cfg });
  assert.match(list, /\* default/);
  assert.match(list, /concise/);
  assert.match(ext.run('bogus', { session: s, cfg: s.cfg }), /No such output style/);
  assert.match(ext.run('concise', { session: s, cfg: s.cfg }, { save: (c) => { saved = c.outputStyle; } }), /concise/);
  assert.equal(saved, 'concise');
  assert.equal(s.cfg.outputStyle, 'concise');
  assert.match(s.messages[0].content, /\[STYLE\]/);
});

test('output-styles: config default is declared', () => {
  assert.equal(require('../src/config').GLOBAL_DEFAULTS.outputStyle, 'default');
});
