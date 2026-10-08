'use strict';

const config = require('./config');
const providers = require('./providers');
const { getJson, validateKey } = require('./api');
const { t, setLang, LANGS } = require('./i18n');
const { C, bar, pad, vlen } = require('./ui');
const { mask, usable, addKeys, nextUtcMidnight } = require('./keys');
const { freeModels, supportsReasoning, fallbackChain, checkModels, readChecks } = require('./models');
const stats = require('./stats');

const log = (...a) => console.log(...a);
const pname = (id) => (providers.PROVIDERS[id] || {}).name || id;
const tag = (id) => C.gray(`[${pname(id)}]`);

// ---------- sağlayıcı ----------

function providerCmd(cfg, id) {
  const all = providers.list();
  if (!id) {
    log(C.bold(t('prov_title')));
    for (const p of all) {
      const n = p.id === cfg.provider ? cfg.keys.length : config.loadKeys(p.id).keys.length;
      const model = p.id === cfg.provider ? cfg.model : (config.load && readModel(p.id));
      log(`${p.id === cfg.provider ? C.orange('▶') : ' '} ${C.cyan(p.id.padEnd(11))} ${C.gray(t('prov_row', n, model || p.defaultModel))}`);
    }
    return true;
  }
  const p = providers.PROVIDERS[id];
  if (!p) { log(C.yellow(t('prov_bad', all.map((x) => x.id).join(', ')))); process.exitCode = 1; return false; }
  if (id !== cfg.provider) config.switchProvider(cfg, id);
  log(C.green(`✔ ${t('prov_set', p.name, cfg.model)}`));
  if (!cfg.keys.length) log(C.yellow(t('prov_nokeys', p.name)));
  return true;
}

// Kayıtlı (ya da varsayılan) model adı: başka sağlayıcıya geçmeden okumak için
function readModel(id) {
  try {
    const raw = JSON.parse(require('fs').readFileSync(config.FILE, 'utf8'));
    return raw.providers && raw.providers[id] && raw.providers[id].model;
  } catch { return null; }
}

// ---------- key'ler ----------

async function keyAdd(cfg, text, opts) {
  const r = await addKeys(cfg, text, opts);
  if (!r.found) return log(C.yellow(t('key_none_found')));
  const short = (k) => (k.length > 14 ? mask(k) : k);
  r.exists.forEach((x) => log(C.yellow(`✖ ${tag(x.provider)} ${t('key_exists', mask(x.key), x.index)}`)));
  r.badFormat.forEach((k) => log(C.red(`✖ ${t('key_badformat', short(k))}`)));
  r.invalid.forEach((x) => log(C.red(`✖ ${tag(x.provider)} ${t('key_invalid', mask(x.key), x.why)}`)));
  r.notes.forEach((x) => log(C.gray(`○ ${tag(x.provider)} ${mask(x.key)} — ${t('key_unverified', x.note)}`)));
  const problems = r.exists.length + r.badFormat.length + r.invalid.length;
  if (!r.added.length) { log(C.yellow(t('key_none_added'))); process.exitCode = 1; return; }
  const byProvider = {};
  r.added.forEach((x) => { byProvider[x.provider] = (byProvider[x.provider] || 0) + 1; });
  for (const [id, n] of Object.entries(byProvider)) {
    const total = id === cfg.provider ? cfg.keys.length : config.loadKeys(id).keys.length;
    log(C.green(`✔ ${pname(id)}: ${t(problems ? 'key_added_except' : 'key_added', n, total)}`));
  }
}

function statusOf(e) {
  if (e.disabled) return C.red(t('st_off', e.reason || ''));
  if (e.blockedUntil > Date.now()) return C.yellow(t('st_wait', new Date(e.blockedUntil).toLocaleTimeString()));
  return C.green(t('st_ready'));
}

function keyList(cfg) {
  log(`${C.bold(pname(cfg.provider))} ${C.gray(`(${config.keysFile(cfg.provider)})`)}`);
  if (!cfg.keys.length) return log(t('key_empty'));
  cfg.keys.forEach((e, i) => log(`${i === cfg.active ? C.orange('▶') : ' '}${C.gray(String(i + 1).padStart(2))}  ${mask(e.key)}  ${statusOf(e)}`));
}

function keyRemove(cfg, n) {
  const i = parseInt(n, 10);
  if (!i || i < 1 || i > cfg.keys.length) { log(t('key_bad_index')); process.exitCode = 1; return; }
  const [r] = cfg.keys.splice(i - 1, 1);
  if (cfg.active > i - 1) cfg.active--;
  cfg.active = Math.max(0, Math.min(cfg.active | 0, cfg.keys.length - 1));
  config.save(cfg);
  log(t('key_removed', mask(r.key)));
}

function keyUse(cfg, n) {
  const i = parseInt(n, 10);
  if (!i || i < 1 || i > cfg.keys.length) { log(t('key_use_bad')); process.exitCode = 1; return false; }
  cfg.active = i - 1;
  config.save(cfg);
  log(C.green(`✔ ${t('key_active', i, mask(cfg.keys[i - 1].key))}`));
  return true;
}

function keyReset(cfg) {
  cfg.keys.forEach((e) => { delete e.disabled; delete e.blockedUntil; delete e.reason; });
  config.save(cfg);
  log(t('key_reset'));
}

// ---------- kullanım ----------

// OpenRouter: /key uç noktası. NVIDIA: kalan kota sorgulanamaz → data null (yerel sayaç kullanılır).
async function fetchInfo(entry) {
  const p = providers.current();
  if (!p.hasUsageApi) return { ok: true, data: {} };
  try { return { ok: true, data: (await getJson('/key', entry.key)).data }; }
  catch (e) { return { ok: false, status: e.status, error: e.message }; }
}

// /key çıktısına göre yerel durumu senkronla (günlük limit dolduysa beklemeye al, dolu değilse aç)
function sync(entry, info) {
  const f = info.free_model_daily_requests;
  if (f && f.remaining === 0) {
    entry.blockedUntil = nextUtcMidnight();
    entry.reason = '429 daily';
  } else if (f && f.remaining > 0 && entry.reason === '429 daily') {
    delete entry.blockedUntil; delete entry.reason;
  }
}

async function usage(cfg, { json = false, check = false } = {}) {
  if (!cfg.keys.length) return log(t('key_empty'));
  const p = providers.current();
  return p.hasUsageApi ? usageOpenRouter(cfg, json) : usageLocal(cfg, p, json, check);
}

// Sağlayıcı başına tek satır yüzde özeti (--json: Orca vb. araçlar için)
async function usageSummary(cfg, { json = false } = {}) {
  const sum = await require('./usage-summary').summary(process.env.SYZER_PROVIDER || null);
  providers.setCurrent(cfg.provider);
  if (json) return log(JSON.stringify(sum.providers.length === 1 ? { ...sum.providers[0], ...sum } : sum, null, 2));
  if (!sum.providers.length) return log(t('key_empty'));
  sum.providers.forEach((r) => log(t('um_line', r.name, r.percent_used == null ? '—' : r.percent_used, r.keys_ready, r.keys_total)));
  if (sum.providers.length > 1) log(C.bold(`${t('um_title')}: ${sum.percent_used == null ? '—' : sum.percent_used + '%'}`));
}

async function usageOpenRouter(cfg, json) {
  const infos = await Promise.all(cfg.keys.map(fetchInfo));
  infos.forEach((r, i) => {
    if (r.ok) sync(cfg.keys[i], r.data);
    else if (r.status === 401) { cfg.keys[i].disabled = true; cfg.keys[i].reason = '401'; }
  });
  config.save(cfg);

  let left = 0;
  let limit = 0;
  const rows = cfg.keys.map((e, i) => {
    const r = infos[i];
    const f = r.ok ? r.data.free_model_daily_requests : null;
    if (f) { left += f.remaining; limit += f.limit; }
    return {
      index: i + 1,
      key: mask(e.key),
      ready: usable(e),
      free: f || null,
      credit: r.ok ? { usage: r.data.usage, limit: r.data.limit, remaining: r.data.limit_remaining } : null,
      free_tier: r.ok ? r.data.is_free_tier : null,
      expires_at: r.ok ? r.data.expires_at : null,
      error: r.ok ? null : r.error,
      state: statusOf(e),
    };
  });

  if (json) {
    const out = rows.map(({ state, ...x }) => x);
    return log(JSON.stringify({ provider: 'openrouter', keys: out, free_requests_left: left, free_requests_limit: limit }, null, 2));
  }

  log(C.bold(`${t('usage_title')} · ${pname('openrouter')}`));
  const W = { n: 2, key: 15, daily: 30, credit: 14 };
  log(C.gray(`${pad('#', W.n)}  ${pad(t('col_key'), W.key)}  ${pad(t('col_daily'), W.daily)}  ${pad(t('col_credit'), W.credit)}  ${t('col_status')}`));
  rows.forEach((r) => {
    let daily;
    if (r.error) daily = C.red(t('usage_err', r.error).slice(0, W.daily));
    else if (r.free) daily = `${bar(r.free.used, r.free.limit)} ${String(r.free.used).padStart(2)}/${r.free.limit} ${C.gray(`(${r.free.remaining} ↓)`)}`;
    else daily = C.gray('—');
    const credit = r.credit ? (r.credit.limit != null ? `$${r.credit.usage.toFixed(2)}/$${r.credit.limit}` : `$${r.credit.usage.toFixed(2)}`) : '—';
    log(`${pad(String(r.index), W.n)}${r.index - 1 === cfg.active ? C.orange('▶') : ' '} ${pad(r.key, W.key)}  ${pad(daily, W.daily)}  ${pad(credit, W.credit)}  ${r.state}`);
  });
  log('');
  log(C.bold(t('usage_total', left, limit)));
  log(C.gray(t('usage_reset', new Date(nextUtcMidnight()).toLocaleTimeString())));
}

// Kalan kota bilgisi vermeyen sağlayıcılar (NVIDIA): yerel istek sayacı + isteğe bağlı canlı doğrulama
async function usageLocal(cfg, p, json, check) {
  const counts = stats.todayKeyCounts(p.id);
  const live = check ? await Promise.all(cfg.keys.map(async (e) => {
    try { await validateKey(p, e.key); return { ok: true }; } catch (err) { return { ok: false, why: `${err.status || ''} ${err.message}`.trim() }; }
  })) : [];
  cfg.keys.forEach((e, i) => { if (live[i] && !live[i].ok && /^(401|403)/.test(live[i].why)) { e.disabled = true; e.reason = String(live[i].why).slice(0, 3); } });
  if (check) config.save(cfg);

  const rows = cfg.keys.map((e, i) => ({ index: i + 1, key: mask(e.key), ready: usable(e), requests_today_local: counts[i + 1] || 0, verified: live[i] ? live[i].ok : null, state: statusOf(e) }));
  if (json) return log(JSON.stringify({ provider: p.id, keys: rows.map(({ state, ...x }) => x), note: 'remaining quota is not exposed by this provider', rpm_limit: p.rpm }, null, 2));

  log(C.bold(`${t('usage_title')} · ${p.name}`));
  const W = { n: 2, key: 17, today: 24 };
  log(C.gray(`${pad('#', W.n)}  ${pad(t('col_key'), W.key)}  ${pad(t('col_today'), W.today)}  ${t('col_status')}`));
  rows.forEach((r) => {
    const verdict = r.verified === null ? '' : r.verified ? C.green(` ✓ ${t('usage_valid')}`) : C.red(` ✖ ${t('usage_invalid')}`);
    log(`${pad(String(r.index), W.n)}${r.index - 1 === cfg.active ? C.orange('▶') : ' '} ${pad(r.key, W.key)}  ${pad(String(r.requests_today_local), W.today)}  ${r.state}${verdict}`);
  });
  log('');
  log(C.gray(t('nv_usage_note', p.rpm)));
  if (!check) log(C.gray(t('usage_check_hint')));
}

// ---------- modeller ----------

const fmtCtx = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n ? `${Math.round(n / 1000)}k` : '—');
const STATUS_MARK = { ok: C.green('✔'), gone: C.red('✖'), overloaded: C.yellow('…'), slow: C.yellow('…'), unknown: C.gray('?') };

function printModels(list, current) {
  const nv = providers.current().id === 'nvidia';
  log(C.bold(t('models_title', list.length)) + C.gray(nv ? `   ✔ ${t('st_ready')}  ✖ ${t('st_gone')}  … ${t('st_busy')}  ? ${t('st_unknown')}` : '   ✦ tools  ◈ reasoning'));
  list.forEach((m, i) => {
    const mark = m.id === current ? C.green('●') : ' ';
    const flags = nv ? (STATUS_MARK[m.status] || '?') + (m.reasoning ? '◈' : ' ') : (m.tools ? '✦' : ' ') + (m.reasoning ? '◈' : ' ');
    log(`${mark} ${C.gray(String(i + 1).padStart(2))}  ${pad(m.id, 52)} ${C.gray(pad(fmtCtx(m.ctx || 0), 5))} ${C.cyan(flags)}`);
  });
  if (nv && list.some((m) => m.status === 'unknown')) log(C.gray(t('models_unverified')));
}

async function modelsList(cfg, query, opts = {}) {
  const list = await freeModels(query, { refresh: !query, all: opts.all });
  if (!list.length) return log(t('models_none'));
  printModels(list, cfg.model);
  return list;
}

// NVIDIA: hangi modeller bu hesapta gerçekten çalışıyor?
async function modelsCheck(cfg, { force = true } = {}) {
  const p = providers.current();
  if (p.hasUsageApi) return log(C.gray(t('check_not_needed', p.name)));
  const entry = cfg.keys[cfg.active] || cfg.keys[0];
  if (!entry) return log(t('key_empty'));
  log(C.gray(t('models_check_start')));
  const results = await checkModels(entry.key, {
    force,
    onProgress: (done, total) => process.stdout.write(`\r  ${done}/${total}   `),
  });
  process.stdout.write('\r\x1b[2K');
  const vals = Object.values(results);
  const ok = vals.filter((v) => v === 'ok').length;
  const gone = vals.filter((v) => v === 'gone').length;
  log(C.green(`✔ ${t('models_check_done', ok, gone, vals.length - ok - gone)}`));
  return results;
}

async function modelSet(cfg, id) {
  let known = true;
  let gone = false;
  try {
    const all = await freeModels(id, { all: true });
    known = all.some((m) => m.id === id);
    gone = all.some((m) => m.id === id && m.status === 'gone');
  } catch { /* çevrimdışı */ }
  cfg.model = id;
  config.save(cfg);
  log(C.green(`✔ ${t('model_set', id)}`));
  if (gone) log(C.yellow(t('model_unavailable')));
  else if (!known) log(C.yellow(t(providers.current().hasUsageApi ? 'model_paid' : 'model_unknown')));
}

// rl.question tabanlı etkileşimli seçici
async function modelPick(cfg, ask) {
  let query = '';
  while (true) {
    const list = await freeModels(query);
    if (!list.length) { log(t('models_none')); query = ''; continue; }
    printModels(list, cfg.model);
    const ans = (await ask(C.cyan(t('model_pick')))).trim();
    if (!ans) return;
    const n = parseInt(ans, 10);
    if (n >= 1 && n <= list.length && String(n) === ans) return modelSet(cfg, list[n - 1].id);
    query = ans;
  }
}

// ---------- dil / izin ----------

function langSet(cfg, code) {
  if (!code) {
    log(Object.entries(LANGS).map(([k, v]) => `${k === cfg.lang ? C.green('●') : ' '} ${k}  ${v}`).join('\n'));
    return;
  }
  if (!LANGS[code]) { log(t('lang_bad', Object.keys(LANGS).join(', '))); process.exitCode = 1; return; }
  cfg.lang = code;
  config.save(cfg);
  setLang(code);
  log(C.green(`✔ ${t('lang_set', `${code} (${LANGS[code]})`)}`));
}

function permSet(cfg, mode) {
  if (!['ask', 'auto', 'readonly'].includes(mode)) { log(t('perm_bad')); return false; }
  cfg.permissions = mode;
  config.save(cfg);
  log(C.green(`✔ ${t('perm_set', mode)}`));
  return true;
}

// ---------- effort / yedek / istatistik ----------

const EFFORTS = ['auto', 'off', 'low', 'medium', 'high', 'xhigh'];

async function effortSet(cfg, level, model) {
  if ((await supportsReasoning(model || cfg.model)) === false) { log(C.yellow(t('effort_unsupported'))); return null; }
  if (!level) { log(t('effort_current', C.cyan(cfg.effort))); return cfg.effort; }
  if (!EFFORTS.includes(level)) { log(t('effort_bad')); process.exitCode = 1; return null; }
  cfg.effort = level;
  config.save(cfg);
  log(C.green(`✔ ${t('effort_set', level)}`));
  return level;
}

async function fallbackSet(cfg, args) {
  const [sub, ...ids] = args;
  if (sub === 'auto' || sub === 'off') cfg.fallback = sub;
  else if (sub === 'set' && ids.length) cfg.fallback = ids;
  else if (sub) { log(C.yellow('auto | off | set <id> <id>')); return; }
  if (sub) { config.save(cfg); log(C.green(`✔ ${t('fallback_set', fbLabel(cfg))}`)); return; }
  const chain = await fallbackChain(cfg, cfg.model);
  log(t('fallback_now', fbLabel(cfg)));
  chain.forEach((id) => log(`  ${C.gray('→')} ${id}`));
}

function fbLabel(cfg) {
  if (cfg.fallback === 'off') return t('fb_off');
  if (Array.isArray(cfg.fallback)) return cfg.fallback.join(', ');
  return t('fb_auto');
}

function statsShow() {
  const rows = stats.recent(7);
  if (!rows.length) return log(t('stats_empty'));
  log(C.bold(t('stats_title')));
  rows.forEach((d) => {
    const models = Object.entries(d.models).map(([m, n]) => `${m.split('/').pop().replace(':free', '')}×${n}`).join(' ');
    log(`${C.cyan(d.date)}  ${t('stats_line', d.requests, d.tokens.toLocaleString())}  ${C.gray(models)}`);
  });
}

// ---------- subagent ----------

function agentsList(agents, cfg) {
  log(C.bold(t('agents_title')));
  agents.forEach((a) => {
    const model = a.model || cfg.subagentModel || t('sub_inherit');
    log(`  ${C.cyan(a.name)} ${C.gray(a.builtin ? `(${t('agent_builtin')})` : `(${a.file})`)}`);
    log(`    ${C.gray(a.description.slice(0, 100))}`);
    log(`    ${C.gray(`${t('lbl_model')}: ${model} · ${t('agent_tools')}: ${a.tools.join(', ')}`)}`);
  });
}

async function subagentSet(cfg, args) {
  const [key, value] = args;
  const none = (v) => v === 'inherit' || v === 'default';
  if (key === 'model' && value) cfg.subagentModel = none(value) ? null : value;
  else if (key === 'effort' && value) {
    if (value !== 'inherit' && !EFFORTS.includes(value)) { log(t('effort_bad')); return; }
    cfg.subagentEffort = value === 'inherit' ? null : value;
  } else if (key === 'concurrency' && value) {
    const n = parseInt(value, 10);
    if (!n || n < 1 || n > 8) { log(t('sub_bad')); return; }
    cfg.subagentConcurrency = n;
  } else if (key) { log(C.yellow(t('sub_bad'))); return; }
  if (key) {
    config.save(cfg);
    if (key === 'model' && cfg.subagentModel && !(await freeModels(cfg.subagentModel)).some((m) => m.id === cfg.subagentModel)) log(C.yellow(t(providers.current().hasUsageApi ? 'model_paid' : 'model_unknown')));
    log(C.green(`✔ ${t('sub_set', `${key} = ${value}`)}`));
  }
  log(t('sub_now', C.cyan(cfg.subagentModel || t('sub_inherit')), cfg.subagentEffort || t('sub_inherit'), cfg.subagentConcurrency || 3));
}

module.exports = {
  agentsList, subagentSet, effortSet, fallbackSet, statsShow, EFFORTS, fetchInfo,
  usageSummary, keyAdd, keyList, keyRemove, keyUse, keyReset, usage, modelsList, modelsCheck, modelSet, modelPick, langSet, permSet, providerCmd, vlen,
};
