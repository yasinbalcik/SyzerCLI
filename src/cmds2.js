'use strict';

const fs = require('fs');
const path = require('path');
const { t } = require('./i18n');
const { C, trunc } = require('./ui');
const settingsMod = require('./settings');
const perms = require('./permissions');
const gitMod = require('./git');
const { quickAsk } = require('./compact');
const { renderTodos } = require('./tools');

const log = (...a) => console.log(...a);

// ---------- izin kuralları ----------

function rulesList(settings) {
  log(C.bold(t('rules_title')));
  if (!settings.allow.length && !settings.deny.length) return log(C.gray(t('rules_none')));
  settings.allow.forEach((r) => log(`  ${C.green('allow')}  ${r}`));
  settings.deny.forEach((r) => log(`  ${C.red('deny ')}  ${r}`));
  log(C.gray(`  ${settings.sources.map((s) => path.basename(path.dirname(s)) + '/' + path.basename(s)).join(' · ')}`));
}

function ruleAdd(cwd, settings, kind, rule) {
  if (!rule || !perms.parseRule(rule)) { log(C.yellow(t('rule_bad'))); process.exitCode = 1; return false; }
  const file = settingsMod.writeRule(cwd, kind, rule);
  settings[kind].push(rule);
  if (!settings.sources.includes(file)) settings.sources.push(file);
  log(C.green(`✔ ${t('rule_added', kind, rule)}`));
  return true;
}

function ruleRemove(cwd, settings, rule) {
  const removed = settingsMod.removeRule(cwd, 'allow', rule) | settingsMod.removeRule(cwd, 'deny', rule);
  settings.allow = settings.allow.filter((r) => r !== rule);
  settings.deny = settings.deny.filter((r) => r !== rule);
  log(removed ? C.green(`✔ ${t('rule_removed', rule)}`) : C.yellow(rule));
}

// ---------- arka plan görevleri / todo ----------

function tasksShow(session, stopArg) {
  const killAll = require('./tools');
  if (stopArg) {
    const id = parseInt(stopArg, 10);
    const e = session.bg.get(id);
    if (e && !e.done) { try { process.platform === 'win32' ? require('child_process').spawn('taskkill', ['/pid', String(e.child.pid), '/t', '/f']) : e.child.kill('SIGTERM'); } catch { /* bitmiş */ } }
    return log(C.green(`✔ ${t('task_stopped', id)}`));
  }
  void killAll;
  if (!session.bg.size) return log(C.gray(t('tasks_none')));
  log(C.bold(t('tasks_title')));
  for (const e of session.bg.values()) {
    const state = e.done ? C.gray(`exit ${e.code}`) : C.green('running');
    log(`  #${e.id} ${state} ${C.gray(`${Math.round((Date.now() - e.started) / 1000)}s`)} ${trunc(e.command, 70)}`);
  }
}

function todosShow(session) {
  if (!session.todos.length) return log(C.gray(t('todos_none')));
  log(renderTodos(session.todos));
}

// ---------- git ----------

function gitDiffShow(cwd) {
  if (!gitMod.isRepo(cwd)) return log(C.yellow(t('git_none')));
  const d = gitMod.diff(cwd);
  if (!d.trim()) return log(C.gray(t('git_nochanges')));
  const lines = d.split('\n');
  log(C.gray(gitMod.stat(cwd).trim()));
  for (const l of lines.slice(0, 200)) {
    if (l.startsWith('+++') || l.startsWith('---') || l.startsWith('diff ') || l.startsWith('index ')) log(C.bold(l));
    else if (l.startsWith('+')) log(C.green(l));
    else if (l.startsWith('-')) log(C.red(l));
    else if (l.startsWith('@@')) log(C.cyan(l));
    else log(C.gray(l));
  }
  if (lines.length > 200) log(C.gray(t('sum_lines', lines.length - 200)));
}

// /commit: mesaj verilmediyse model yazar; onaydan sonra commit atılır
async function commitFlow(session, message, readKey) {
  const cwd = session.cwd;
  if (!gitMod.isRepo(cwd)) return log(C.yellow(t('git_none')));
  const status = gitMod.status(cwd);
  if (!status.trim()) return log(C.gray(t('git_nochanges')));
  log(C.gray(status.trim()));
  let msg = message;
  if (!msg) {
    const diff = gitMod.git(cwd, ['diff', 'HEAD']).out || gitMod.git(cwd, ['diff']).out;
    msg = await quickAsk(
      session,
      `Write a git commit message for these changes. Imperative mood, subject line max 72 chars, optional short body after a blank line. Reply with ONLY the message.\n\nStatus:\n${status}\n\nDiff:\n${diff.slice(0, 20000)}`,
      'You write precise git commit messages.',
    );
    msg = msg.replace(/^```\w*\n?|\n?```$/g, '').trim();
  }
  log(`${C.bold(t('commit_msg'))}\n${C.cyan(msg.split('\n').map((l) => '  ' + l).join('\n'))}`);
  const a = await readKey(C.cyan(t('commit_confirm')));
  if (!/^(y|e|j|s|o|t)/.test(a)) return log(C.gray(t('commit_cancel')));
  const add = gitMod.git(cwd, ['add', '-A']);
  if (add.code !== 0) return log(C.red(t('commit_fail', add.err.trim())));
  const c = gitMod.git(cwd, ['commit', '-m', msg]);
  if (c.code !== 0) return log(C.red(t('commit_fail', (c.err || c.out).trim())));
  log(C.green(`✔ ${t('commit_ok', gitMod.git(cwd, ['log', '-1', '--format=%h %s']).out.trim())}`));
}

function reviewPrompt(cwd) {
  if (!gitMod.isRepo(cwd)) { log(C.yellow(t('git_none'))); return null; }
  const d = gitMod.diff(cwd);
  if (!d.trim()) { log(C.gray(t('git_nochanges'))); return null; }
  return `Review this diff for bugs, risky changes, missing edge cases and style problems. Be specific (file and line) and concise; end with a short verdict.\n\n\`\`\`diff\n${d.slice(0, 40000)}\n\`\`\``;
}

function checkpointsShow(session) {
  if (!session.checkpoints.length) return log(C.gray(t('cp_none')));
  session.checkpoints.slice(-9).forEach((c, i) => log(`  ${C.gray(String(i + 1))}  ${C.cyan(c.hash.slice(0, 8))}  ${new Date(c.ts).toLocaleTimeString()}  ${C.gray(c.label)}`));
}

async function restoreFlow(session, readKey) {
  if (!session.checkpoints.length) return log(C.gray(t('cp_none')));
  const list = session.checkpoints.slice(-9);
  checkpointsShow(session);
  const k = await readKey(C.cyan(t('cp_pick')));
  const pick = list[parseInt(k, 10) - 1];
  if (!pick) return log(C.gray(t('commit_cancel')));
  const r = gitMod.restore(session.cwd, pick.hash);
  log(r.code === 0 ? C.green(`✔ ${t('cp_restored', pick.hash.slice(0, 8))}`) : C.red(r.err.trim()));
}

// ---------- not / hafıza ----------

function noteMemory(cwd, text) {
  const file = path.join(cwd, 'SYZER.md');
  if (!fs.existsSync(file)) fs.writeFileSync(file, '# SyzerCLI notes\n\n');
  fs.appendFileSync(file, `- ${text.trim()}\n`);
  log(C.green(`✔ ${t('mem_saved', 'SYZER.md')}`));
}

module.exports = {
  rulesList, ruleAdd, ruleRemove, tasksShow, todosShow, gitDiffShow, commitFlow, reviewPrompt,
  checkpointsShow, restoreFlow, noteMemory,
};
