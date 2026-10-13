'use strict';

const { buildContext } = require('./context');
const { newId } = require('./sessions');
const settingsMod = require('./settings');

// Sade modda modelin gördüğü araçlar (küçük modeller orkestrasyon araçlarında kayboluyor)
const SIMPLE_TOOLS = ['read_file', 'write_file', 'edit_file', 'list_dir', 'find_files', 'search_files', 'run_command'];
const isSimple = () => !!(require('./providers').current() || {}).simple;
function systemFor(cwd, ctx) {
  if (!isSimple()) return ctx.system;
  const { getLang } = require('./i18n');
  return require('./prompts').simpleSystem({ cwd, platform: process.platform, language: getLang(), instructionFiles: ctx.files });
}

function createSession(cfg, { cwd = process.cwd(), model, perm, effort, useTools = true, agents = true, canAsk = false, confirm, out }) {
  const ctx = buildContext(cwd);
  return {
    cfg,
    cwd,
    ctx,
    model: model || ((require('./routing').explicit('edit', cfg) || {}).model) || cfg.model, // routing.edit yalnızca açıkça ayarlıysa
    perm: perm || cfg.permissions || 'ask',
    effort: effort || cfg.effort || 'auto',
    plan: false,
    undo: [],
    settings: settingsMod.load(cwd),
    mcp: null,
    bg: new Map(),
    checkpoints: [],
    cpDone: false,
    todos: [],
    canAsk,
    sessionId: newId(),
    useTools,
    canSpawn: useTools && agents && !isSimple(),
    allowedTools: isSimple() ? new Set(SIMPLE_TOOLS) : undefined,
    skills: ctx.skills,
    confirm: confirm || (async () => 'no'),
    out,
    messages: [{ role: 'system', content: systemFor(cwd, ctx) }],
  };
}

function resetSession(s) {
  s.messages = [{ role: 'system', content: systemFor(s.cwd, s.ctx) }];
  s.sessionId = newId(); // yeni konuşma = yeni kayıt (eski oturum geçmişte kalır)
  s.runs = [];
  s.todos = [];
  s.planDone = new Set();
  s.turnMarks = []; // /rewind işaretleri yeni konuşmada geçersiz
}

// Sağlayıcı değişince (ör. /provider) sade mod ayarlarını oturuma yeniden uygular
function applyProviderMode(s) {
  s.allowedTools = isSimple() ? new Set(SIMPLE_TOOLS) : undefined;
  s.canSpawn = s.useTools && !isSimple();
  if (s.messages[0] && s.messages[0].role === 'system') s.messages[0].content = systemFor(s.cwd, s.ctx);
}

module.exports = { applyProviderMode, SIMPLE_TOOLS, createSession, resetSession };
