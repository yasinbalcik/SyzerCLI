'use strict';

// Doğrulama kapısı: model araç çağırmadan "bitti" dediğinde projenin testini çalıştırır.
// Test komutu bulunamazsa ya da kapalıysa hiçbir şey yapmaz (sessiz atlama).

const fs = require('fs');
const path = require('path');

const RUNNER = /^(?:(?:python3?|py)(?:\s+-3(?:\.\d+)?)?\s+-m\s+(?:unittest|pytest)|pytest|npm\s+(?:run\s+)?test|npm\s+t|yarn\s+test|pnpm\s+test|node\s+--test|go\s+test|cargo\s+test)(?:\s|$)/i;
const UNSAFE = /[;|&<>$`\n\r]/;
const CODE_FILE = /\.(py|js|mjs|cjs|ts|tsx|jsx|go|rs|java|rb|php|c|cc|cpp|h|cs)$/i;
const clamp = (n, lo, hi, d) => { n = Number(n); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d; };
const read = (p, max = 40000) => { try { return fs.readFileSync(p, 'utf8').slice(0, max); } catch { return ''; } };

// Metindeki (TASK.md / istem) satır içi `komut` ya da kod bloğu satırlarından ilk güvenli test komutu
function commandFromText(text) {
  const spans = [];
  const s = String(text || '');
  for (const m of s.matchAll(/`([^`\n]+)`/g)) spans.push(m[1]);
  for (const m of s.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) {
    for (const line of m[1].split('\n')) spans.push(line.replace(/^\s*(?:\$|>|PS>)\s*/, ''));
  }
  for (const c of spans.map((x) => x.trim())) {
    if (c && c.length < 200 && RUNNER.test(c) && !UNSAFE.test(c)) return c;
  }
  return null;
}

function pythonCommand(cwd, platform) {
  const py = platform === 'win32' ? 'python' : 'python3';
  let top = [];
  try { top = fs.readdirSync(cwd); } catch { return null; }
  const has = (re) => top.some((f) => re.test(f));
  const pytestCfg = top.includes('pytest.ini') || top.includes('conftest.py')
    || /\[tool\.pytest/.test(read(path.join(cwd, 'pyproject.toml'))) || /\[pytest\]|\[tool:pytest\]/.test(read(path.join(cwd, 'setup.cfg')) + read(path.join(cwd, 'tox.ini')));
  const hasTop = has(/^test_.*\.py$/) || has(/^.*_test\.py$/);
  let hasDir = false;
  try { hasDir = fs.readdirSync(path.join(cwd, 'tests')).some((f) => /^test_.*\.py$/.test(f)); } catch { /* tests/ yok */ }
  if (!hasTop && !hasDir) return null;
  if (pytestCfg) return `${py} -m pytest -q`;
  if (has(/^test_.*\.py$/)) return `${py} -m unittest`;
  if (hasTop) return `${py} -m unittest discover -p "*_test.py"`;
  return `${py} -m unittest discover -s tests -t .`;
}

// Sıra: ayarla verilen komut → TASK.md / istem içindeki komut → package.json test script'i → Python test dosyaları. Yoksa null.
function detect(cwd, { taskText = '', command = null, platform = process.platform } = {}) {
  if (command) return { cmd: command, source: 'config' };
  const fromTask = commandFromText(`${read(path.join(cwd, 'TASK.md'))}\n${taskText}`);
  if (fromTask) return { cmd: fromTask, source: 'task' };
  try {
    const pkg = JSON.parse(read(path.join(cwd, 'package.json')));
    const s = pkg && pkg.scripts && pkg.scripts.test;
    if (typeof s === 'string' && s.trim() && !/no test specified/i.test(s)) return { cmd: 'npm test', source: 'package.json' };
  } catch { /* package.json yok/bozuk */ }
  const py = pythonCommand(cwd, platform);
  return py ? { cmd: py, source: 'python' } : null;
}

// Ayarlar: cfg.verify (false | 'off' | { enabled, retries, command, timeoutSec }) ve SYZER_VERIFY=off|on
function settings(session) {
  const env = String(process.env.SYZER_VERIFY || '').toLowerCase();
  const raw = session.cfg && session.cfg.verify;
  const o = raw && typeof raw === 'object' ? raw : {};
  let enabled = !(raw === false || raw === 'off' || o.enabled === false || session.noVerify);
  if (['0', 'off', 'false', 'no'].includes(env)) enabled = false;
  else if (['1', 'on', 'true', 'yes'].includes(env)) enabled = !session.noVerify;
  if (process.env.SYZER_VERIFY_ACTIVE) enabled = false; // test komutunun içinden başlayan oturum: özyineleme olmasın
  if (session.agentName || session.plan || session.perm === 'readonly') enabled = false; // alt ajan / salt-okunur: koşturma
  return {
    enabled,
    retries: clamp(o.retries, 1, 5, 3),
    timeoutSec: clamp(o.timeoutSec, 10, 600, 120),
    command: typeof o.command === 'string' && o.command.trim() ? o.command.trim() : null,
  };
}

// execute() sonucundan: { status: 'pass' | 'fail' | 'skip', code, output }
function classify(r) {
  const out = String((r && r.output) || '');
  if (!r) return { status: 'skip', code: null, output: '' };
  const none = /\bRan 0 tests\b|no tests ran|collected 0 items|no test files|no tests found/i;
  if (r.ok) return none.test(out) ? { status: 'skip', code: 0, output: out } : { status: 'pass', code: 0, output: out.replace(/\n?\[exit 0\]\s*$/, '') };
  const m = /command exited with code (-?\d+)/.exec(out);
  if (!m) return { status: 'skip', code: null, output: out }; // engellendi/reddedildi: test başarısızlığı değil
  const code = Number(m[1]);
  const body = out.split('\n').slice(1).join('\n');
  const missing = /is not recognized as|command not found|not found|No module named pytest|ENOENT|The system cannot find/i;
  if ((code === 127 || missing.test(body)) && !/Traceback|FAILED|AssertionError|failures=|\bfail\b/i.test(body)) return { status: 'skip', code, output: body };
  if (none.test(body)) return { status: 'skip', code, output: body };
  return { status: 'fail', code, output: body };
}

// Modele geri verilecek özet: ilk başarısız blok + son satırlar, sınırlı uzunluk
function summarize(out, max = 2500) {
  const s = String(out || '').replace(/\r/g, '').trim();
  const i = s.search(/^(?:ERROR|FAIL): /m);
  const body = i >= 0 ? s.slice(i) : s;
  if (body.length <= max) return body;
  return `${body.slice(0, max - 600)}\n…(truncated)…\n${body.slice(-600)}`;
}

// Onay istemeden koşturulabilir mi? (auto izin modu ya da komut için allow kuralı)
function canRunSilently(session, cmd) {
  if (session.perm === 'auto') return true;
  try { return require('./permissions').decide(session.settings, 'run_command', { command: cmd }, session.cwd).verdict === 'allow'; } catch { return false; }
}

// execute() ile (izin/readonly/plan kuralları aynen geçerli) test komutunu koşturur; sonucu sınıflandırır.
// silent: onay gerektiriyorsa hiç koşturma (skip). Özyineleme koruması: test komutu kendi içinde syzer turu başlatırsa kapı kapalıdır.
async function run(session, cmd, timeoutSec, { silent = false } = {}) {
  if (silent && !canRunSilently(session, cmd)) return { status: 'skip', code: null, output: '' };
  const tools = require('./tools');
  const call = { id: 'verify', name: 'run_command', arguments: JSON.stringify({ command: cmd, timeout_seconds: timeoutSec }) };
  const prev = process.env.SYZER_VERIFY_ACTIVE;
  process.env.SYZER_VERIFY_ACTIVE = '1';
  try {
    const r = await tools.execute(call, session);
    return { ...classify(r), raw: r };
  } finally {
    if (prev === undefined) delete process.env.SYZER_VERIFY_ACTIVE; else process.env.SYZER_VERIFY_ACTIVE = prev;
  }
}

// Gereksinim çıkarımı için kaynak: cwd/TASK.md + kullanıcı istemi
function taskSource(cwd, taskText) {
  return `${read(path.join(cwd, 'TASK.md'))}\n${taskText || ''}`;
}

// İskeleli modda: kod dosyası yazıldıktan sonra testi koştur; araç çıktısına eklenecek kısa not ('' = ekleme)
async function autoTest(session, tc, { taskText = '', ver } = {}) {
  let file = '';
  try { file = String(JSON.parse(tc.arguments || '{}').path || ''); } catch { /* geçersiz argüman */ }
  if (!CODE_FILE.test(file)) return '';
  const det = detect(session.cwd, { taskText, command: ver && ver.command });
  if (!det) return '';
  const v = await run(session, det.cmd, (ver && ver.timeoutSec) || 120, { silent: true });
  if (v.status === 'skip') return '';
  const tb = require('./prompts').tracebackHint(v.output, { language: require('./i18n').getLang() });
  const head = v.status === 'pass' ? `[auto-test after write] ${det.cmd}: PASSED` : `[auto-test after write] ${det.cmd}: FAILED (exit ${v.code}). Fix this before the next step.`;
  return [head, v.status === 'pass' ? '' : summarize(v.output, 1500), v.status === 'pass' ? '' : tb].filter(Boolean).join('\n');
}

module.exports = { detect, commandFromText, settings, classify, summarize, run, taskSource, autoTest, canRunSilently, CODE_FILE };
