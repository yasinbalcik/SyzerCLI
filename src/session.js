'use strict';

const { buildContext } = require('./context');
const { newId } = require('./sessions');
const settingsMod = require('./settings');

function createSession(cfg, { cwd = process.cwd(), model, perm, effort, useTools = true, agents = true, canAsk = false, confirm, out }) {
  const ctx = buildContext(cwd);
  return {
    cfg,
    cwd,
    ctx,
    model: model || cfg.model,
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
    canSpawn: useTools && agents,
    skills: ctx.skills,
    confirm: confirm || (async () => 'no'),
    out,
    messages: [{ role: 'system', content: ctx.system }],
  };
}

function resetSession(s) {
  s.messages = [{ role: 'system', content: s.ctx.system }];
}

module.exports = { createSession, resetSession };
