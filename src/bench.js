'use strict';

// `syzer bench <model>`: test/bench/<görev>/TASK.md görevini modele temiz bir geçici klasörde verir,
// bittikten sonra modelin göremediği hidden/ testini çalıştırıp x/N skorunu yazar.
// Gizlilik: hidden/ asla çalışma klasörüne kopyalanmaz; model yalnızca TASK.md görür.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const BENCH_DIR = path.join(__dirname, '..', 'test', 'bench');
const BIN = path.join(__dirname, '..', 'bin', 'syzer.js');
const PROMPT = 'Read TASK.md in the working directory and complete the task exactly as specified. Write the files it asks for, run your own tests, and make sure they pass before you finish.';

// Görevler: TASK.md ve hidden/ içeren alt klasörler
function listTasks(dir = BENCH_DIR) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names.filter((n) => {
    const d = path.join(dir, n);
    try { return fs.statSync(d).isDirectory() && fs.existsSync(path.join(d, 'TASK.md')) && fs.statSync(path.join(d, 'hidden')).isDirectory(); } catch { return false; }
  }).sort();
}

function hiddenFiles(taskDir) {
  const h = path.join(taskDir, 'hidden');
  return fs.readdirSync(h).filter((f) => /^test.*\.py$/.test(f) || /\.test\.js$/.test(f)).map((f) => path.join(h, f));
}

// unittest çıktısından skor: { passed, total, ok }. "Ran N tests" yoksa (import hatası) fallbackTotal ile 0 geçti.
function parseScore(output, fallbackTotal = 0) {
  const s = String(output || '');
  const ran = /Ran (\d+) tests?/.exec(s);
  if (!ran) return { passed: 0, total: fallbackTotal, ok: false };
  const total = Number(ran[1]);
  const bad = /FAILED \(([^)]*)\)/.exec(s);
  const num = (k) => { const m = new RegExp(`${k}=(\\d+)`).exec(bad ? bad[1] : ''); return m ? Number(m[1]) : 0; };
  const failed = num('failures') + num('errors');
  const passed = Math.max(0, total - failed);
  return { passed, total, ok: !bad && total > 0 };
}

const countTests = (file) => { try { return (fs.readFileSync(file, 'utf8').match(/^\s+def test_/gm) || []).length; } catch { return 0; } };

// Gizli testi modelin çalışma klasöründe (cwd) çalıştırır; hidden dosyası yerinde kalır (kopyalanmaz)
function scoreWorkspace(taskDir, ws, { python } = {}) {
  const py = python || process.env.SYZER_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  let passed = 0;
  let total = 0;
  let log = '';
  for (const file of hiddenFiles(taskDir)) {
    const r = spawnSync(py, [file, '-v'], { cwd: ws, encoding: 'utf8', timeout: 180000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8' } });
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    log += out;
    const sc = parseScore(out, countTests(file));
    passed += sc.passed;
    total += sc.total;
  }
  return { passed, total, ok: total > 0 && passed === total, log };
}

// Temiz geçici klasör: yalnızca TASK.md (hidden/ kopyalanmaz)
function prepareWorkspace(taskDir, name = 'task') {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), `syzer-bench-${name}-`));
  fs.copyFileSync(path.join(taskDir, 'TASK.md'), path.join(ws, 'TASK.md'));
  return ws;
}

function runModel(ws, { model, provider, timeoutMin, baseline, quiet = true }) {
  const args = [BIN, '--prompt', PROMPT, '-y', '--quiet', '--json', '--no-update'];
  if (model) args.push('-m', model);
  if (provider) args.push('--provider', provider);
  if (timeoutMin) args.push('--timeout-minutes', String(timeoutMin));
  const env = { ...process.env };
  if (baseline) { env.SYZER_VERIFY = 'off'; env.SYZER_SCAFFOLD = 'off'; } // iyileştirmeler kapalı kıyas
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: ws, env, stdio: ['ignore', 'pipe', quiet ? 'ignore' : 'inherit'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', (e) => resolve({ code: -1, out: e.message }));
    child.on('close', (code) => resolve({ code, out }));
  });
}

// f: { model, task, keep, baseline, json, provider, timeoutMinutes }; sub: konumsal model kimliği
async function run(f = {}, sub) {
  const tasks = listTasks();
  if (sub === 'list' || (!sub && !f.model)) {
    console.log(tasks.length ? `bench tasks: ${tasks.join(', ')}\nusage: syzer bench <model> [--task ${tasks[0] || 'name'}] [--baseline] [--keep] [--json]` : 'no bench tasks found in test/bench');
    return;
  }
  const model = f.model || sub;
  const picked = f.task ? [f.task] : tasks;
  const results = [];
  for (const name of picked) {
    const taskDir = path.join(BENCH_DIR, name);
    if (!tasks.includes(name)) { console.error(`Unknown bench task "${name}". Available: ${tasks.join(', ')}`); process.exitCode = 2; return; }
    const ws = prepareWorkspace(taskDir, name);
    const t0 = Date.now();
    const r = await runModel(ws, { model, provider: f.provider, timeoutMin: f.timeoutMinutes || 20, baseline: f.baseline });
    const sc = scoreWorkspace(taskDir, ws);
    const row = { task: name, model, passed: sc.passed, total: sc.total, ok: sc.ok, ms: Date.now() - t0, exit: r.code, baseline: !!f.baseline, workspace: ws };
    results.push(row);
    if (!f.json) console.log(`bench ${name} · ${model}${f.baseline ? ' (baseline)' : ''}: ${sc.passed}/${sc.total}${sc.ok ? ' ✔' : ''} · ${(row.ms / 1000).toFixed(0)}s · syzer exit ${r.code}${f.keep ? ` · ${ws}` : ''}`);
    if (!f.keep) { try { fs.rmSync(ws, { recursive: true, force: true }); } catch { /* önemsiz */ } }
  }
  if (f.json) console.log(JSON.stringify(results.length === 1 ? results[0] : results));
  process.exitCode = results.every((x) => x.ok) ? 0 : 1;
}

module.exports = { run, listTasks, prepareWorkspace, parseScore, scoreWorkspace, hiddenFiles, PROMPT };
