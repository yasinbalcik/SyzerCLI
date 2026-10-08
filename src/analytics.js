'use strict';

// `syzer stats --json --usage-analytics`: Orca → Ayarlar → Stats & Usage → "Syzer" filtresinin okuduğu JSON (schemaVersion 1).
//   daily:    (gün, model, proje) başına satır — girdi (önbellek dahil) / çıktı (akıl yürütme dahil) token'ları
//   sessions: kayıtlı oturumlar (~/.syzercli/sessions)
const fs = require('fs');
const path = require('path');
const config = require('./config');

const SEP = String.fromCharCode(1);
const norm = (p) => String(p || '').replace(/[\\/]+/g, '/').toLowerCase();
const projectKey = (cwd) => (cwd ? `cwd:${norm(cwd)}` : 'cwd:unknown');
const projectLabel = (cwd) => (cwd ? String(cwd).replace(/[\\/]+$/, '').split(/[\\/]/).slice(-2).join('/') : 'unknown');
const isFree = (m) => /:free$|^openrouter\/free$/.test(String(m));

function readJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }

function build() {
  const stats = readJson(path.join(config.DIR, 'stats.json')) || {};
  const daily = [];
  for (const [day, d] of Object.entries(stats)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const mp = d.mp || {};
    const done = new Set(); // mp'de kapsanan model istekleri
    for (const [k, v] of Object.entries(mp)) {
      const [model, cwd] = k.split(SEP);
      done.add(model);
      daily.push({ day, model, projectKey: projectKey(cwd), projectLabel: projectLabel(cwd), inputTokens: v.in || 0, cachedInputTokens: Math.min(v.cache || 0, v.in || 0), outputTokens: v.out || 0, reasoningOutputTokens: v.reasoning || 0, eventCount: v.requests || 0, estimatedCostUsd: isFree(model) ? 0 : null });
    }
    // proje ayrıntısı olmayan günler/modeller: modelStats ya da yalnızca istek sayıları
    const ms = d.modelStats || {};
    for (const [model, v] of Object.entries(ms)) {
      if (done.has(model)) continue;
      daily.push({ day, model, projectKey: 'cwd:unknown', projectLabel: 'unknown', inputTokens: v.in || 0, cachedInputTokens: Math.min(v.cache || 0, v.in || 0), outputTokens: v.out || (v.in ? 0 : v.tokens || 0), reasoningOutputTokens: v.reasoning || 0, eventCount: v.requests || 0, estimatedCostUsd: isFree(model) ? 0 : null });
      done.add(model);
    }
    const models = d.models || {};
    const total = Object.values(models).reduce((a, b) => a + b, 0) || 1;
    for (const [model, n] of Object.entries(models)) {
      if (done.has(model)) continue;
      daily.push({ day, model, projectKey: 'cwd:unknown', projectLabel: 'unknown', inputTokens: 0, cachedInputTokens: 0, outputTokens: Math.round(((d.tokens || 0) * n) / total), reasoningOutputTokens: 0, eventCount: n, estimatedCostUsd: isFree(model) ? 0 : null });
    }
  }

  const sessions = [];
  const dir = path.join(config.DIR, 'sessions');
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { /* yok */ }
  for (const f of files) {
    const s = readJson(path.join(dir, f));
    if (!s || !s.id) continue;
    const id = String(s.id);
    const first = new Date(Date.UTC(+id.slice(0, 4), +id.slice(4, 6) - 1, +id.slice(6, 8), +id.slice(8, 10), +id.slice(10, 12), +id.slice(12, 14)));
    const last = new Date(s.ts || first.getTime());
    const events = (s.messages || []).filter((m) => m && m.role === 'assistant').length;
    sessions.push({ sessionId: id, firstTimestamp: (Number.isNaN(first.getTime()) ? last : first).toISOString(), lastTimestamp: last.toISOString(), primaryModel: s.model || null, primaryProjectLabel: projectLabel(s.cwd), models: s.model ? [s.model] : [], projectKeys: [projectKey(s.cwd)], eventCount: events, totalInputTokens: 0, totalCachedInputTokens: 0, totalOutputTokens: 0, totalReasoningOutputTokens: 0 });
  }
  return { schemaVersion: 1, generatedAt: new Date().toISOString(), daily, sessions };
}

module.exports = { build, SEP };
