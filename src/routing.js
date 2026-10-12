'use strict';

// Model yönlendirme: rol → model. Hepsi opt-in; boş rol = mevcut davranış.
//   explore   salt-okunur araştırma alt ajanları
//   plan      planlama alt ajanları (plan tipi)
//   edit      dosya yazan ana tur / yazma yetkili alt ajanlar (varsayılan cfg.model)
//   summarize bağlam sıkıştırma özeti (varsayılan subagentModel yoksa cfg.model)
// Öncelik: ortam (SYZER_ROUTE_<ROL>) > config.routing > varsayılan.

const ROLES = ['explore', 'plan', 'edit', 'summarize'];
const ENV = { explore: 'SYZER_ROUTE_EXPLORE', plan: 'SYZER_ROUTE_PLAN', edit: 'SYZER_ROUTE_EDIT', summarize: 'SYZER_ROUTE_SUMMARIZE' };
const READ_ONLY = new Set(['read_file', 'list_dir', 'find_files', 'search_files', 'use_skill', 'web_fetch', 'web_search']);

const clean = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

// Ham config değerini { explore?, plan?, edit?, summarize?, escalate } biçimine getirir (bilinmeyen alanlar atılır)
function normalize(raw) {
  const o = { escalate: false };
  if (!raw || typeof raw !== 'object') return o;
  for (const r of ROLES) { const v = clean(raw[r]); if (v) o[r] = v; }
  o.escalate = raw.escalate === true;
  return o;
}

// Açıkça ayarlanmış model: { model, source: 'env'|'config' } | null
function explicit(role, cfg, env = process.env) {
  const e = clean(env && env[ENV[role]]);
  if (e) return { model: e, source: 'env' };
  const c = clean(normalize(cfg && cfg.routing)[role]);
  return c ? { model: c, source: 'config' } : null;
}

// Etkin model. fallback: rol ayarsızsa mevcut davranışın modeli (alt ajanlar için ebeveyn modeli).
// → { model, source: 'env'|'config'|'default' }
function resolve(role, cfg, env = process.env, fallback) {
  const x = explicit(role, cfg, env);
  if (x) return x;
  const c = cfg || {};
  const base = role === 'edit' ? c.model
    : role === 'summarize' ? (c.subagentModel || c.model)
    : (c.subagentModel || fallback || c.model);
  return { model: base || null, source: 'default' };
}

// Alt ajanın rolü: salt-okunur → explore; plan tipi → plan; yazma yetkili → edit; yoksa null
function roleForAgent(agent, readOnly) {
  const tools = (agent && agent.tools) || [];
  const roOnly = tools.length > 0 && tools.every((n) => READ_ONLY.has(n));
  if (readOnly || roOnly || (agent && agent.name === 'explore')) return 'explore';
  if (agent && agent.name === 'plan') return 'plan';
  return 'edit';
}

// Alt ajan için yönlendirilmiş model (yalnızca açıkça ayarlıysa) → { role, model } | null
function subagentRoute(agent, readOnly, cfg, env = process.env) {
  const role = roleForAgent(agent, readOnly);
  const x = explicit(role, cfg, env);
  return x ? { role, model: x.model, source: x.source } : null;
}

// Kademeli yükseltme kararı. first/second: spawn sonuçları (isBad ile aynı ölçüt), used: ilk iki denemenin
// modeli, target: yükseltilecek model, routedRole: modeli yönlendirme verdiyse rolü (yoksa null), done: bu görevde zaten yükseltildi mi.
function shouldEscalate({ enabled, first, second, used, target, routedRole, done }, isBad) {
  if (!enabled || done || !routedRole || !target) return false;
  if (used && used === target) return false;
  return !!(first && second && isBad(first) && isBad(second));
}

// Doğrulama: { warnings: [] }. known: bilinen model id listesi (yoksa/boşsa model denetimi atlanır)
function validate(raw, known) {
  const warnings = [];
  if (raw === null || raw === undefined) return { warnings };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { warnings: ['routing must be an object'] };
  const ids = known && known.length ? new Set(known) : null;
  for (const k of Object.keys(raw)) {
    if (k === 'escalate') { if (typeof raw[k] !== 'boolean') warnings.push('routing.escalate must be true/false'); continue; }
    if (!ROLES.includes(k)) { warnings.push(`unknown role "${k}" (roles: ${ROLES.join(', ')})`); continue; }
    if (!clean(raw[k])) { warnings.push(`routing.${k} must be a model id`); continue; }
    if (ids && !ids.has(raw[k].trim())) warnings.push(`model "${raw[k]}" for ${k} is not in the provider's model list (kept)`);
  }
  return { warnings };
}

module.exports = { ROLES, ENV, normalize, explicit, resolve, roleForAgent, subagentRoute, shouldEscalate, validate };
