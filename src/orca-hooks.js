'use strict';
// Orca agent-status reporter for Syzer. CommonJS, no deps.
// Posts to Orca's local hook server as source "hermes" (see report); Orca shows the
// pane as working / waiting / done. Silent no-op outside Orca. Never throws, never
// blocks longer than TIMEOUT_MS per event (events are sent serially to keep order).
const http = require('http');
const fs = require('fs');

const TIMEOUT_MS = 800;
const AGENT_TYPE = 'syzer'; // Orca'da kendi ajan kimliği (yama: orca_agent_type işareti)
const SOURCE = 'hermes';
let chain = Promise.resolve();

function readEndpoint() {
  const out = {};
  try {
    const p = process.env.ORCA_AGENT_HOOK_ENDPOINT;
    if (p) {
      for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
        const m = line.trim().match(/^(?:set\s+)?([A-Z0-9_]+)=(.*)$/i);
        if (m) out[m[1]] = m[2].replace(/\r$/, '');
      }
    }
  } catch (_) { /* fall back to env */ }
  const e = process.env;
  return {
    port: out.ORCA_AGENT_HOOK_PORT || e.ORCA_AGENT_HOOK_PORT,
    token: out.ORCA_AGENT_HOOK_TOKEN || e.ORCA_AGENT_HOOK_TOKEN,
    env: out.ORCA_AGENT_HOOK_ENV || e.ORCA_AGENT_HOOK_ENV || '',
    version: out.ORCA_AGENT_HOOK_VERSION || e.ORCA_AGENT_HOOK_VERSION || '1'
  };
}

function send(eventName, payload) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    try {
      const paneKey = process.env.ORCA_PANE_KEY;
      const c = readEndpoint();
      if (!paneKey || !c.port || !c.token) return finish();
      const body = JSON.stringify({
        paneKey,
        tabId: process.env.ORCA_TAB_ID || '',
        launchToken: process.env.ORCA_AGENT_LAUNCH_TOKEN || '',
        worktreeId: process.env.ORCA_WORKTREE_ID || '',
        env: c.env,
        version: c.version,
        hook_event_name: eventName,
        payload: Object.assign({ hook_event_name: eventName, orca_agent_type: AGENT_TYPE }, payload)
      });
      const req = http.request({
        host: '127.0.0.1',
        port: Number(c.port),
        path: '/hook/' + SOURCE,
        method: 'POST',
        agent: false,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'X-Orca-Agent-Hook-Token': c.token
        }
      }, (res) => { res.resume(); res.on('end', finish); res.on('error', finish); res.on('close', finish); });
      const timer = setTimeout(() => { try { req.destroy(); } catch (_) {} finish(); }, TIMEOUT_MS);
      req.on("error", (e)=>{if(process.env.DBG)console.error(e);finish();});
      req.on('close', () => { clearTimeout(timer); finish(); });
      req.end(body);
    } catch (_) { finish(); }
  });
}

function enqueue(eventName, payload) {
  if (!process.env.ORCA_PANE_KEY) return Promise.resolve();
  chain = chain.then(() => send(eventName, payload)).catch(() => {});
  return chain;
}

const str = (v, n) => String(v == null ? '' : v).slice(0, n || 4000);

// user submitted a prompt -> working
function promptSubmitted(prompt) { return enqueue('pre_llm_call', { prompt: str(prompt) }); }
// a tool call began -> working (shows tool name in the row)
function toolStarted(name, input) {
  const p = { tool_name: str(name, 200) };
  if (input !== undefined) p.tool_input = typeof input === 'object' && input ? input : { command: str(input, 1000) };
  return enqueue('pre_tool_call', p);
}
function toolFinished(name) { return enqueue('post_tool_call', { tool_name: str(name, 200) }); }
// assistant turn finished -> done
function turnDone(lastAssistantMessage) {
  return enqueue('post_llm_call', { last_assistant_message: str(lastAssistantMessage) });
}
// blocked on user permission/question -> waiting
function waiting(kind) {
  return enqueue('pre_approval_request', { tool_name: str(kind || 'approval', 200) });
}
// alt ajan başladı/bitti → Orca kenar çubuğunda çalışan alt ajan listesi (yalnızca çalışanlar gösterilir)
function subagentStart({ id, kind }) { return enqueue('SubagentStart', { agent_id: str(id, 64), agent_type: str(kind || 'general-purpose', 60) }); }
function subagentStop({ id }) { return enqueue('SubagentStop', { agent_id: str(id, 64) }); }
function resumed() { return enqueue('post_approval_response', { tool_name: 'approval' }); }
// session exit -> done (idle)
function end() { return enqueue('on_session_end', {}); }
// await before process.exit(); bounded by TIMEOUT_MS per queued event
function flush() { return chain; }

module.exports = { subagentStart, subagentStop, promptSubmitted, toolStarted, toolFinished, turnDone, waiting, resumed, end, flush };
