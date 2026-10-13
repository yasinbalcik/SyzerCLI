'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

process.env.SYZER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'syzer-wb-home-'));
delete process.env.SYZER_SCAFFOLD;
require('../src/i18n').setLang('en');
const P = require('../src/prompts');
const M = require('../src/models');
const B = require('../src/bench');
const { execute } = require('../src/tools');

// ---------- traceback ipucu ----------

const PY_TB = [
  'Traceback (most recent call last):',
  '  File "/usr/lib/python3.10/unittest/case.py", line 59, in testPartExecutor',
  '  File "/work/test_ledger.py", line 12, in test_balance',
  '  File "/work/ledger.py", line 41, in balance',
  "AttributeError: 'Ledger' object has no attribute '_bal'",
].join('\n');

test('tracebackHint: kendi kodundaki hata için dosya:satır içeren ipucu', () => {
  const h = P.tracebackHint(PY_TB, { language: 'en' });
  assert.match(h, /^\[hint\] AttributeError/);
  assert.match(h, /ledger\.py:41/); // stdlib çerçevesi değil, projenin son çerçevesi
  assert.match(P.tracebackHint(PY_TB, { language: 'tr' }), /\[ipucu\] AttributeError/);
});

test('tracebackHint: ImportError/NameError/ModuleNotFoundError, düz metin ve çerçevesiz anma ipucu vermez', () => {
  for (const kind of ['ImportError', 'NameError', 'ModuleNotFoundError', 'UnboundLocalError']) {
    assert.match(P.tracebackHint(`Traceback (most recent call last):\n  File "a.py", line 1, in <module>\n${kind}: boom`), new RegExp(kind));
  }
  assert.match(P.tracebackHint('ReferenceError: x is not defined\n    at Object.<anonymous> (/w/a.js:3:1)'), /ReferenceError/);
  assert.strictEqual(P.tracebackHint('the docs mention AttributeError: when you misuse things'), '');
  assert.strictEqual(P.tracebackHint('all tests passed'), '');
  assert.strictEqual(P.tracebackHint(''), '');
});

test('run_command: başarısız çıktı tam gelir ve traceback ipucu eklenir', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'syzer-wb-'));
  fs.writeFileSync(path.join(cwd, 'boom.js'), [
    'console.error("Traceback (most recent call last):");',
    'console.error("  File \\"/w/ledger.py\\", line 7, in apply");',
    'console.error("NameError: name \'Decimal\' is not defined");',
    'console.error("second-to-last-line");',
    'process.exit(1);',
  ].join('\n'));
  const session = { cwd, perm: 'auto', settings: { allow: [], deny: [], hooks: { PreToolUse: [], PostToolUse: [] } }, bg: new Map(), cpDone: true };
  const r = await execute({ name: 'run_command', arguments: JSON.stringify({ command: 'node boom.js' }) }, session);
  assert.strictEqual(r.ok, false);
  assert.match(r.output, /command exited with code 1/);
  assert.match(r.output, /NameError: name 'Decimal' is not defined/);
  assert.match(r.output, /second-to-last-line/); // eskiden yalnızca ilk satır kalıyordu
  assert.match(r.output, /\[hint\] NameError .*ledger\.py:7/s);
});

// ---------- şartname çıkarımı ----------

test('requirementsFrom: madde işaretleri, anahtar kelimeli cümleler, tekrarsız ve sınırlı', () => {
  const md = '# T\n- first requirement here\n* second requirement here\n1. third requirement here\n- first requirement here\nprose line';
  assert.deepStrictEqual(P.requirementsFrom(md), ['first requirement here', 'second requirement here', 'third requirement here']);
  const prose = 'The parser must reject empty lines. It returns a Decimal. Nothing else matters here at all.';
  assert.deepStrictEqual(P.requirementsFrom(prose), ['The parser must reject empty lines.', 'It returns a Decimal.']);
  assert.deepStrictEqual(P.requirementsFrom('merhaba nasılsın'), []);
  assert.strictEqual(P.requirementsFrom(Array.from({ length: 40 }, (_, i) => `- requirement number ${i}`).join('\n')).length, 15);
  assert.ok(P.requirementsFrom('- snake_case_name stays intact')[0].includes('snake_case_name'));
});

test('requirementsCheck: her madde numaralı ve kanıt istenir', () => {
  const m = P.requirementsCheck(['a thing', 'b thing'], { language: 'en' });
  assert.match(m, /1\. a thing\n2\. b thing/);
  assert.match(m, /evidence/);
  assert.match(P.requirementsCheck(['a'], { language: 'tr' }), /kanıt/);
});

// ---------- zayıf model profili ----------

test('scaffoldFor: boyut, ad ve sağlayıcıya göre; ayar ve ortam geçersiz kılar', () => {
  const f = (id, cfg = {}) => M.scaffoldFor(cfg, id);
  assert.strictEqual(f('qwen2.5-coder:7b'), true);
  assert.strictEqual(f('meta/llama-3.1-8b-instruct'), true);
  assert.strictEqual(f('nvidia/nemotron-nano-9b-v2'), true);
  assert.strictEqual(f('google/gemma-3-12b-it'), true);
  assert.strictEqual(f('qwen/qwen3-30b-a3b'), false); // 30B toplam: güçlü sayılır
  assert.strictEqual(f('meta/llama-3.1-70b-instruct'), false);
  assert.strictEqual(f('anthropic/claude-sonnet-4'), false);
  assert.strictEqual(f('openai/gpt-5-mini'), false); // güçlü aile adı kazanır
  assert.strictEqual(f('some/phi-3-mini'), true);
  assert.strictEqual(f('vendor/unknown-model'), false); // varsayılan sağlayıcı: openrouter/nvidia

  assert.strictEqual(f('meta/llama-3.1-70b-instruct', { scaffold: 'on' }), true);
  assert.strictEqual(f('qwen2.5-coder:7b', { scaffold: 'off' }), false);
  process.env.SYZER_SCAFFOLD = 'on';
  try { assert.strictEqual(f('anthropic/claude-sonnet-4'), true); } finally { delete process.env.SYZER_SCAFFOLD; }
  assert.strictEqual(M.paramSize('qwen3-30b-a3b'), 30);
  assert.strictEqual(M.paramSize('gpt-oss'), null);
});

test('scaffoldFor: özel (Ollama vb.) sağlayıcıda boyutsuz model iskeleli', () => {
  const providers = require('../src/providers');
  const orig = providers.current;
  providers.current = () => ({ id: 'ollama', custom: true });
  try {
    assert.strictEqual(M.scaffoldFor({}, 'mymodel'), true);
    assert.strictEqual(M.scaffoldFor({}, 'anthropic/claude-sonnet-4'), false);
  } finally { providers.current = orig; }
});

test('scaffold prompt: iki dilde, test-önce ve yazım-sonrası-çalıştır kurallarını içerir', () => {
  const en = P.scaffold({ language: 'en' });
  assert.match(en, /^\[SCAFFOLD\]/);
  assert.match(en, /write tests/i);
  assert.match(en, /After every write_file\/edit_file, run the tests/);
  assert.match(P.scaffold({ language: 'tr' }), /Her write_file\/edit_file sonrası/);
});

// ---------- bench ----------

test('bench: ledger görevi listelenir; hidden test modele giden çalışma klasörüne kopyalanmaz', () => {
  assert.ok(B.listTasks().includes('ledger'));
  const taskDir = path.join(__dirname, 'bench', 'ledger');
  assert.ok(fs.existsSync(path.join(taskDir, 'TASK.md')));
  assert.ok(B.hiddenFiles(taskDir).some((f) => /test_hidden\.py$/.test(f)));
  const ws = B.prepareWorkspace(taskDir, 'ledger');
  try {
    assert.deepStrictEqual(fs.readdirSync(ws), ['TASK.md']);
    assert.ok(!/hidden/i.test(fs.readFileSync(path.join(ws, 'TASK.md'), 'utf8')));
  } finally { fs.rmSync(ws, { recursive: true, force: true }); }
  assert.ok(!/hidden/i.test(B.PROMPT)); // istem de gizli testten söz etmez
});

test('bench: parseScore unittest çıktısını x/N yapar', () => {
  assert.deepStrictEqual(B.parseScore('Ran 13 tests in 0.5s\n\nFAILED (failures=2)', 13), { passed: 11, total: 13, ok: false });
  assert.deepStrictEqual(B.parseScore('Ran 13 tests in 0.5s\n\nFAILED (failures=3, errors=3)', 13), { passed: 7, total: 13, ok: false });
  assert.deepStrictEqual(B.parseScore('Ran 13 tests in 0.5s\n\nOK', 13), { passed: 13, total: 13, ok: true });
  assert.deepStrictEqual(B.parseScore("Traceback...\nModuleNotFoundError: No module named 'ledger'", 13), { passed: 0, total: 13, ok: false });
});

test('bench: scoreWorkspace hidden testi çalışma klasöründe çalıştırır (python varsa)', (ctx) => {
  const py = process.env.SYZER_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  if (spawnSync(py, ['--version']).status !== 0) return ctx.skip('python yok');
  const taskDir = fs.mkdtempSync(path.join(os.tmpdir(), 'syzer-wb-task-'));
  fs.mkdirSync(path.join(taskDir, 'hidden'));
  fs.writeFileSync(path.join(taskDir, 'TASK.md'), 'write calc.py');
  fs.writeFileSync(path.join(taskDir, 'hidden', 'test_hidden.py'), [
    'import os, sys, unittest',
    'sys.path.insert(0, os.getcwd())',
    'import calc',
    'class T(unittest.TestCase):',
    '    def test_add(self): self.assertEqual(calc.add(1, 2), 3)',
    '    def test_neg(self): self.assertEqual(calc.add(-1, 1), 0)',
    '    def test_bad(self): self.assertEqual(calc.add(2, 2), 5)',
    'if __name__ == "__main__": unittest.main()',
  ].join('\n'));
  const ws = B.prepareWorkspace(taskDir, 'calc');
  try {
    assert.deepStrictEqual(B.scoreWorkspace(taskDir, ws).total, 3); // calc.py yok → import hatası: 0/3 (test sayısı dosyadan)
    assert.strictEqual(B.scoreWorkspace(taskDir, ws).passed, 0);
    fs.writeFileSync(path.join(ws, 'calc.py'), 'def add(a, b):\n    return a + b\n');
    const r = B.scoreWorkspace(taskDir, ws);
    assert.strictEqual(`${r.passed}/${r.total}`, '2/3');
    assert.strictEqual(r.ok, false);
    assert.ok(fs.readdirSync(ws).sort().join() === 'TASK.md,calc.py'); // çalışma klasörüne hidden dosyası ya da pyc bırakılmadı
  } finally { fs.rmSync(ws, { recursive: true, force: true }); fs.rmSync(taskDir, { recursive: true, force: true }); }
});
