'use strict';

// GitHub sürüm kontrolü ve indirme. Bağımlılıksız: launcher (exe) ile aynen paylaşılır.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const REPO = process.env.SYZER_REPO || 'yasinbalcik/SyzerCLI';
const HOME = process.env.SYZER_HOME || path.join(os.homedir(), '.syzercli');
const APP_DIR = path.join(HOME, 'app');
const CHECK_FILE = path.join(HOME, 'update-check.json');
const CHECK_TTL = 60 * 60 * 1000; // son kontrolden 1 saat içinde tekrar sorma
const TIMEOUT = 4000;

const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };

// Repo özelse token gerekir: env → ~/.syzercli/github-token → gh CLI
function token() {
  const env = process.env.SYZER_GH_TOKEN || process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (env) return env.trim();
  try { const f = fs.readFileSync(path.join(HOME, 'github-token'), 'utf8').trim(); if (f) return f; } catch { /* yok */ }
  try { return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null; } catch { return null; }
}

const cmpVer = (a, b) => {
  const x = String(a).replace(/^v/, '').split('.').map(Number);
  const y = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0) ? 1 : -1; }
  return 0;
};

async function gh(url, accept = 'application/vnd.github+json') {
  const tk = token();
  const headers = { Accept: accept, 'User-Agent': 'SyzerCLI-updater', 'X-GitHub-Api-Version': '2022-11-28' };
  if (tk) headers.Authorization = `Bearer ${tk}`;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(url.includes('/releases/latest') ? TIMEOUT : 120000), redirect: 'follow' });
  if (!res.ok) throw new Error(`GitHub ${res.status}${res.status === 404 && !tk ? ' (private repo? set GITHUB_TOKEN or run "gh auth login")' : ''}`);
  return res;
}

// En son sürüm: { version, assetUrl } — asset adı syzercli-<ver>.tar.gz
async function latest({ force = false } = {}) {
  const cache = readJson(CHECK_FILE);
  if (!force && cache && Date.now() - cache.at < CHECK_TTL && cache.latest) return cache.latest;
  const rel = await (await gh(`https://api.github.com/repos/${REPO}/releases/latest`)).json();
  const asset = (rel.assets || []).find((a) => /^syzercli-.*\.tar\.gz$/.test(a.name));
  if (!asset) throw new Error('release has no syzercli-*.tar.gz asset');
  const info = { version: String(rel.tag_name).replace(/^v/, ''), assetUrl: asset.url };
  try { fs.mkdirSync(HOME, { recursive: true }); fs.writeFileSync(CHECK_FILE, JSON.stringify({ at: Date.now(), latest: info })); } catch { /* önemsiz */ }
  return info;
}

const installed = () => { const j = readJson(path.join(APP_DIR, 'current.json')); return j && fs.existsSync(path.join(APP_DIR, j.version, 'bin', 'syzer.js')) ? j.version : null; };

// Tarball'u indirip APP_DIR/<ver> altına açar, current.json'u günceller, eski sürümleri siler
async function install(info) {
  const dest = path.join(APP_DIR, info.version);
  const tmp = `${dest}.tmp`;
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  const tarFile = path.join(tmp, 'pkg.tar.gz');
  fs.writeFileSync(tarFile, Buffer.from(await (await gh(info.assetUrl, 'application/octet-stream')).arrayBuffer()));
  const r = spawnSync('tar', ['-xzf', 'pkg.tar.gz'], { cwd: tmp, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`tar failed: ${(r.stderr || '').trim()}`);
  fs.rmSync(tarFile);
  if (!fs.existsSync(path.join(tmp, 'bin', 'syzer.js'))) throw new Error('corrupt package (bin/syzer.js missing)');
  fs.rmSync(dest, { recursive: true, force: true });
  fs.renameSync(tmp, dest);
  fs.writeFileSync(path.join(APP_DIR, 'current.json'), JSON.stringify({ version: info.version }));
  for (const d of fs.readdirSync(APP_DIR)) if (d !== info.version && /^\d/.test(d)) fs.rmSync(path.join(APP_DIR, d), { recursive: true, force: true });
}

module.exports = { REPO, HOME, APP_DIR, latest, install, installed, cmpVer, token, gh };
