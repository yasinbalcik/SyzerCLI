'use strict';

// Orca içinde görünür Syzer işçileri: her işçi ayrı bir Orca terminalinde çalışan bağımsız bir Syzer sürecidir.
// Ana ajan görevi dosyaya yazar, `orca terminal create` ile yeni sekmede `syzer -y --prompt-file … --out …` başlatır,
// sonuç dosyası belirince raporu okur. İşçi terminali açık kalır → içeriği Orca'da izlenebilir.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const config = require('./config');

const available = () => !!process.env.ORCA_PANE_KEY && !process.env.SYZER_NO_WORKERS;

const orcaCli = () => process.env.ORCA_CLI_COMMAND || (process.platform === 'win32' ? 'orca.exe' : 'orca');

const runCli = (args, signal) => new Promise((resolve, reject) => {
  execFile(orcaCli(), args, { timeout: 30000, windowsHide: true, ...(signal ? { signal } : {}) }, (err, out, errOut) => (err ? reject(new Error((errOut || err.message).toString().trim().split('\n')[0])) : resolve(out)));
});

// Orca terminalinin kabuğu (PowerShell/cmd/bash) bilinmediğinden mümkünse PATH'teki yalın `syzer` komutu kullanılır
let cached;
function selfCmd() {
  if (cached) return cached;
  let onPath = false;
  try { onPath = require('child_process').spawnSync(process.platform === 'win32' ? 'where' : 'which', ['syzer'], { stdio: 'ignore' }).status === 0; } catch { /* yok */ }
  if (onPath) return (cached = 'syzer');
  const exe = process.env.SYZER_LAUNCHER ? [process.execPath] : [process.execPath, path.join(__dirname, '..', 'bin', 'syzer.js')];
  const q = exe.map((x) => `"${x}"`).join(' ');
  return (cached = process.platform === 'win32' ? `& ${q}` : q); // PowerShell çağrı işleci
}

async function spawnWorker(parent, call, signal) {
  let a;
  try { a = JSON.parse(call.arguments || '{}'); } catch { return { ok: false, output: 'Invalid JSON arguments.' }; }
  if (!a.prompt) return { ok: false, output: 'prompt is required.' };
  const id = crypto.randomBytes(4).toString('hex');
  const dir = path.join(config.DIR, 'workers', id);
  fs.mkdirSync(dir, { recursive: true });
  const promptFile = path.join(dir, 'prompt.txt');
  const outFile = path.join(dir, 'result.txt');
  fs.writeFileSync(promptFile, a.prompt);
  const title = `Syzer: ${String(a.title || a.description || 'worker').slice(0, 40)}`;
  const po = parent.out;
  po.agentStart && po.agentStart(`w${id}`, `worker: ${title}`);
  const t0 = Date.now();
  const run = { id: `w${id}`, label: title, agent: 'syzer-worker', prompt: a.prompt, steps: [], report: '', ok: false };
  parent.runs = parent.runs || [];
  parent.runs.push(run);
  try {
    const wt = process.env.ORCA_WORKTREE_ID ? `id:${process.env.ORCA_WORKTREE_ID}` : 'active';
    const cmd = `${selfCmd()} -y --prompt-file "${promptFile}" --out "${outFile}"${a.agent ? ` -a ${a.agent}` : ''}`;
    await runCli(['terminal', 'create', '--worktree', wt, '--title', title, '--command', cmd, '--json'], signal);
    // sonucu bekle (en çok 15 dk)
    const deadline = Date.now() + 15 * 60 * 1000;
    while (!fs.existsSync(outFile)) {
      if (signal && signal.aborted) { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
      if (Date.now() > deadline) throw new Error('worker timed out (15 min)');
      await new Promise((r) => setTimeout(r, 1000));
    }
    await new Promise((r) => setTimeout(r, 300)); // yazma bitsin
    const report = fs.readFileSync(outFile, 'utf8').trim() || '(no output)';
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
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
    return { ok: false, output: `Worker failed: ${err.message}`, ui: { summary: `${title}: ${err.message}` } };
  } finally {
    run.secs = run.secs || ((Date.now() - t0) / 1000).toFixed(1);
    po.agentDone && po.agentDone(`w${id}`, run);
  }
}

module.exports = { available, spawnWorker };
