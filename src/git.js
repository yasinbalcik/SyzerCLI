'use strict';

const { spawnSync } = require('child_process');

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

const isRepo = (cwd) => git(cwd, ['rev-parse', '--is-inside-work-tree']).out.trim() === 'true';
const hasCommits = (cwd) => git(cwd, ['rev-parse', '--verify', 'HEAD']).code === 0;

// Çalışma ağacının anlık görüntüsü (dosyaları değiştirmeden): `git stash create` → commit hash'i
function checkpoint(cwd) {
  if (!isRepo(cwd) || !hasCommits(cwd)) return null;
  const s = git(cwd, ['stash', 'create']).out.trim();
  return s || git(cwd, ['rev-parse', 'HEAD']).out.trim(); // değişiklik yoksa HEAD
}

function restore(cwd, hash) {
  return git(cwd, ['restore', `--source=${hash}`, '--staged', '--worktree', '--', '.']);
}

const diff = (cwd, staged) => git(cwd, ['diff', ...(staged ? ['--staged'] : ['HEAD'])]).out;
const stat = (cwd) => git(cwd, ['diff', '--stat', 'HEAD']).out;
const status = (cwd) => git(cwd, ['status', '--short']).out;

module.exports = { git, isRepo, hasCommits, checkpoint, restore, diff, stat, status };
