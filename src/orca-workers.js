'use strict';

// Orca içinde görünür Syzer işçileri: her işçi ayrı bir Orca terminalinde çalışan bağımsız bir Syzer sürecidir.
// Ana ajan görevi dosyaya yazar, `orca terminal create` ile yeni sekmede `syzer … --prompt-file … --out …` başlatır,
// sonuç dosyası belirince raporu okur. İşçi terminali açık kalır → içeriği Orca'da izlenebilir.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile, spawnSync } = require('child_process');
const config = require('./config');
const { usable } = require('./keys');

const available = () => !!process.env.ORCA_PANE_KEY && !process.env.SYZER_NO_WORKERS;
const MAX_ATTEMPTS = 2;
let keyCounter = 0;

const orcaCli = () => process.env.ORCA_CLI_COMMAND || (process.platform === 'win32' ? 'orca.exe' : 'orca');

const runCli = (args, signal) => new Promise((resolve, reject) => {
  execFile(orcaCli(), args, { timeout: 30000, windowsHide: true, ...(signal ? { signal } : {}) }, (err, out, errOut) => (err ? reject(new Error((errOut || err.message).toString().trim().split('\n')[0])) : resolve(out)));
});

// Orca terminalinin kabuğu (PowerShell/cmd/bash) bilinmediğinden mümkünse PATH'teki yalın `syzer` komutu kullanılır
let cached;
function selfCmd() {
  if (cached) return cached;
  let onPath = false;
  try { onPath = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['syzer'], { stdio: 'ignore' }).status === 0; } catch { /* yok */ }
  if (onPath) return (cached = 'syzer');
  const exe = process.env.SYZER_LAUNCHER ? [process.execPath] : [process.execPath, path.join(__dirname, '..', 'bin', 'syzer.js')];
  const q = exe.map((x) => `"${x}"`).join(' ');
  return (cached = process.platform === 'win32' ? `& ${q}` : q); // PowerShell çağrı işleci
}

// Paralel işçiler farklı key'lerle başlar (aynı key'in limitine toplu çarpmasınlar)
function nextKeyFlag(cfg, attempt) {
  const idx = (cfg.keys || []).map((e, i) => (usable(e) ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return '';
  return ` -k ${idx[(keyCounter++ + attempt) % idx.length] + 1}`;
}

async function runOnce(parent, a, id, attempt, signal) {
  const dir = path.join(config.DIR, 'workers', id);
  const promptFile = path.join(dir, 'prompt.txt');
  const outFile = path.join(dir, 'result.txt');
  fs.rmSync(outFile, { force: true });
  const title = `Syzer: ${String(a.title || a.description || 'worker').slice(0, 40)}`;
  const wt = process.env.ORCA_WORKTREE_ID ? `id:${process.env.ORCA_WORKTREE_ID}` : 'active';
  // İzin devri: ana oturum tam otomatikse işçi de otomatik; değilse işçi salt okunur çalışır
  const perm = parent.perm === 'auto' ? ' -y' : '';
  const cmd = `${selfCmd()}${perm}${nextKeyFlag(parent.cfg, attempt)} --title "${title}" --prompt-file "${promptFile}" --out "${outFile}"${a.agent ? ` -a ${a.agent}` : ''}`;
  const created = await runCli(['terminal', 'create', '--worktree', wt, '--title', title, '--command', cmd, '--json'], signal);
  let handle = null;
  try { handle = JSON.parse(created).result.terminal.handle; } catch { /* önemsiz */ }

  const deadline = Date.now() + 15 * 60 * 1000;
  while (!fs.existsSync(outFile)) {
    if (signal && signal.aborted) { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
    if (Date.now() > deadline) throw new Error('worker timed out (15 min)');
    await new Promise((r) => setTimeout(r, 1000));
  }
  await new Promise((r) => setTimeout(r, 300)); // yazma bitsin
  const report = fs.readFileSync(outFile, 'utf8').trim() || '(no output)';
  if (process.env.SYZER_WORKER_CLOSE && handle) runCli(['terminal', 'close', '--terminal', handle, '--json']).catch(() => {});
  return report;
}

async function spawnWorker(parent, call, signal) {
  let a;
  try { a = JSON.parse(call.arguments || '{}'); } catch { return { ok: false, output: 'Invalid JSON arguments.' }; }
  if (!a.prompt) return { ok: false, output: 'prompt is required.' };
  const id = crypto.randomBytes(4).toString('hex');
  fs.mkdirSync(path.join(config.DIR, 'workers', id), { recursive: true });
  fs.writeFileSync(path.join(config.DIR, 'workers', id, 'prompt.txt'), a.prompt);
  const title = `Syzer: ${String(a.title || a.description || 'worker').slice(0, 40)}`;
  const po = parent.out;
  po.agentStart && po.agentStart(`w${id}`, `worker: ${title}`);
  po.agentUpdate && po.agentUpdate(`w${id}`, 'Orca sekmesinde çalışıyor');
  const t0 = Date.now();
  const run = { id: `w${id}`, label: title, agent: 'syzer-worker', prompt: a.prompt, steps: [], report: '', ok: false };
  parent.runs = parent.runs || [];
  parent.runs.push(run);
  try {
    let report = '';
    let lastErr = '';
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        report = await runOnce(parent, a, id, attempt, signal);
        if (!/^ERROR:/.test(report)) { lastErr = ''; break; }
        lastErr = report; // işçi kendi hatasını yazdı → farklı key ile bir kez daha dene
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        lastErr = `ERROR: ${err.message}`;
      }
      run.steps.push({ tool: 'attempt', summary: `attempt ${attempt + 1} failed`, result: lastErr.slice(0, 200), ok: false });
      if (attempt + 1 < MAX_ATTEMPTS) po.warn && po.warn(`[${title}] ${lastErr.slice(0, 120)} — yeniden deneniyor`);
    }
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    if (lastErr) {
      Object.assign(run, { report: lastErr, ok: false, secs });
      return {
        ok: false,
        output: `WORKER FAILED after ${MAX_ATTEMPTS} attempts: ${lastErr}\nDo NOT silently do this work yourself. Tell the user this worker failed and why.`,
        ui: { summary: `${title}: BAŞARISIZ (${secs}s)` },
      };
    }
    Object.assign(run, { report, ok: true, secs });
    const lines = report.split('\n').filter((l) => l.trim());
    return {
      ok: true,
      output: report.length > 8000 ? `${report.slice(0, 8000)}\n…(truncated)` : report,
      ui: { summary: `${title} · ${secs}s · terminal sekmesinde izlenebilir`, body: lines.slice(0, 5).map((l) => `    ${l.slice(0, 110)}`).join('\n') },
    };
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    run.report = `failed: ${err.message}`;
    return { ok: false, output: `WORKER FAILED: ${err.message}\nDo NOT silently do this work yourself; report the failure to the user.`, ui: { summary: `${title}: ${err.message}` } };
  } finally {
    run.secs = run.secs || ((Date.now() - t0) / 1000).toFixed(1);
    po.agentDone && po.agentDone(`w${id}`, run);
  }
}

module.exports = { available, spawnWorker };
