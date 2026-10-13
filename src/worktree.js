'use strict';
// Alt ajanlar için isteğe bağlı git worktree izolasyonu.
// Worktree yalnızca <config.DIR>/worktrees altında, benzersiz dalda (syzer/agent-<id>) açılır.
// Ana çalışma ağacına hiçbir şey yazılmaz; birleştirme yapılmaz.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const gitMod = require('./git');

const BRANCH_PREFIX = 'syzer/agent-';

function baseDir(opts) {
  return path.resolve((opts && opts.baseDir) || path.join(require('./config').DIR, 'worktrees'));
}

// Yalnızca küçük harf, rakam ve tire
function cleanId(s) { return String(s).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40); }
function newId() { return cleanId(`${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`); }

// Başarı: { ok: true, id, path, cwd, branch, base, root } ; başarısızlık: { ok: false, reason }
function create(cwd, opts) {
  try {
    if (!gitMod.isRepo(cwd)) return { ok: false, reason: 'not a git repository' };
    if (!gitMod.hasCommits(cwd)) return { ok: false, reason: 'repository has no commits' };
    const top = gitMod.git(cwd, ['rev-parse', '--show-toplevel']).out.trim();
    if (!top) return { ok: false, reason: 'cannot resolve repository root' };
    const base = gitMod.git(cwd, ['rev-parse', 'HEAD']).out.trim();
    const id = newId();
    const root = baseDir(opts);
    const wt = path.resolve(root, id);
    if (path.dirname(wt) !== root) return { ok: false, reason: 'unsafe worktree path' };
    fs.mkdirSync(root, { recursive: true });
    const branch = BRANCH_PREFIX + id;
    const r = gitMod.git(cwd, ['worktree', 'add', '-q', '-b', branch, wt, base]);
    if (r.code !== 0) return { ok: false, reason: (r.err || r.out || 'git worktree add failed').trim().split('\n')[0] };
    // Alt dizinden çağrıldıysa aynı göreli dizinde çalış
    const rel = path.relative(path.resolve(top), path.resolve(cwd));
    let sub = wt;
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
      const cand = path.join(wt, rel);
      if (fs.existsSync(cand)) sub = cand;
    }
    return { ok: true, id, path: wt, cwd: sub, branch, base, root: top };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

// Bitişte çağrılır: değişiklik yoksa worktree + dalı siler; varsa korur.
// → { kept: boolean, path, branch, stat }
function finish(wt) {
  const out = { kept: false, path: wt.path, branch: wt.branch, stat: '' };
  try {
    const dirty = gitMod.git(wt.path, ['status', '--porcelain']).out.trim() !== '';
    const head = gitMod.git(wt.path, ['rev-parse', 'HEAD']).out.trim();
    const changed = dirty || (head && head !== wt.base);
    if (changed) {
      gitMod.git(wt.path, ['add', '-A']); // worktree'nin kendi indeksi; yalnızca stat için
      out.stat = gitMod.git(wt.path, ['diff', '--stat', '--cached', wt.base]).out.trim();
      out.kept = true;
      return out;
    }
  } catch { /* temizliğe devam */ }
  remove(wt);
  return out;
}

function remove(wt) {
  try {
    gitMod.git(wt.root, ['worktree', 'remove', '--force', wt.path]);
    if (fs.existsSync(wt.path)) fs.rmSync(wt.path, { recursive: true, force: true });
    gitMod.git(wt.root, ['worktree', 'prune']);
    gitMod.git(wt.root, ['branch', '-D', wt.branch]);
  } catch { /* önemsiz */ }
}

function note(info) {
  return `[worktree] Changes were left UNMERGED in an isolated worktree.\npath: ${info.path}\nbranch: ${info.branch}\n` +
    (info.stat ? `diff --stat:\n${info.stat}\n` : '') + 'Tell the user; review or merge the branch yourself if wanted, then `git worktree remove` it.';
}

module.exports = { create, finish, remove, note, BRANCH_PREFIX };
