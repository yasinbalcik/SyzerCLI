'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = process.env.SYZER_HOME || path.join(os.homedir(), '.syzercli');
const OLD_DIR = path.join(os.homedir(), '.openrouter-cli'); // eski sürümden otomatik taşınır
const FILE = path.join(DIR, 'config.json');
const keysFile = (provider) => path.join(DIR, `keys.${provider}.json`);

// Sağlayıcıdan bağımsız ayarlar
const GLOBAL_DEFAULTS = {
  lang: 'tr',
  provider: 'openrouter',
  permissions: 'ask', // ask | auto | readonly
  subagentEffort: null, // null = ana oturumla aynı
  subagentConcurrency: 3,
  setupDone: false, // ilk kurulum sihirbazı tamamlandı mı
  autoUpdate: true, // açılışta GitHub'dan güncelleme kontrolü
};

// Her sağlayıcı için ayrı tutulan ayarlar (model, effort, yedek modeller, subagent modeli)
const PER_PROVIDER = ['model', 'effort', 'fallback', 'subagentModel'];

const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const writeJson = (p, obj) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), { mode: 0o600 });
};

// Eski ~/.openrouter-cli klasörünü yeni konuma kopyalar (bir kez)
function migrate() {
  if (fs.existsSync(DIR) || !fs.existsSync(OLD_DIR)) return;
  try { fs.cpSync(OLD_DIR, DIR, { recursive: true }); } catch { fs.mkdirSync(DIR, { recursive: true }); }
}

// ---------- key dosyaları (sağlayıcı başına ayrı) ----------

function loadKeys(provider) {
  const j = readJson(keysFile(provider));
  return { active: (j && j.active) | 0, keys: j && Array.isArray(j.keys) ? j.keys : [] };
}

function saveKeys(provider, store) {
  writeJson(keysFile(provider), { active: store.active | 0, keys: store.keys });
}

// ---------- yükleme / kaydetme ----------

function providerDefaults(provider) {
  const { PROVIDERS } = require('./providers');
  const p = PROVIDERS[provider];
  return { model: p.defaultModel, effort: 'auto', fallback: p.defaultFallback, subagentModel: null };
}

// cfg nesnesini verilen sağlayıcının ayarları ve key'leriyle yerinde günceller
function attach(cfg, provider, raw) {
  const saved = (raw.providers && raw.providers[provider]) || {};
  Object.assign(cfg, providerDefaults(provider), saved);
  const envModel = process.env.SYZER_MODEL || process.env.OPENROUTER_MODEL;
  cfg._envModel = !!envModel && provider === cfg.provider;
  if (cfg._envModel) cfg.model = envModel;
  const store = loadKeys(provider);
  cfg.keys = store.keys;
  cfg.active = store.active;
  cfg.provider = provider;
  require('./providers').setCurrent(provider);
}

function load() {
  migrate();
  const raw = readJson(FILE) || {};

  // Eski tek-dosyalı biçimden geçiş: keys → keys.openrouter.json, model vb. → providers.openrouter
  if (Array.isArray(raw.keys)) {
    if (!fs.existsSync(keysFile('openrouter'))) saveKeys('openrouter', { active: raw.active, keys: raw.keys });
    raw.providers = raw.providers || {};
    raw.providers.openrouter = raw.providers.openrouter || {};
    for (const f of PER_PROVIDER) if (raw[f] !== undefined && raw.providers.openrouter[f] === undefined) raw.providers.openrouter[f] = raw[f];
    for (const f of ['keys', 'active', ...PER_PROVIDER]) delete raw[f];
    writeJson(FILE, raw);
  }

  const cfg = {};
  for (const k of Object.keys(GLOBAL_DEFAULTS)) cfg[k] = raw[k] !== undefined ? raw[k] : GLOBAL_DEFAULTS[k];
  const { PROVIDERS } = require('./providers');
  const wanted = process.env.SYZER_PROVIDER || cfg.provider;
  cfg.provider = PROVIDERS[wanted] ? wanted : 'openrouter';
  attach(cfg, cfg.provider, raw);
  return cfg;
}

function save(cfg) {
  const raw = readJson(FILE) || {};
  for (const k of Object.keys(GLOBAL_DEFAULTS)) { if (k === 'provider' && process.env.SYZER_PROVIDER) continue; raw[k] = cfg[k]; }
  raw.providers = raw.providers || {};
  const block = (raw.providers[cfg.provider] = raw.providers[cfg.provider] || {});
  for (const f of PER_PROVIDER) {
    if (f === 'model' && cfg._envModel) continue; // ortam değişkeniyle geçici verilen model kaydedilmez
    block[f] = cfg[f];
  }
  writeJson(FILE, raw);
  saveKeys(cfg.provider, { active: cfg.active, keys: cfg.keys });
}

// Çalışan oturumdaki aynı cfg nesnesini başka sağlayıcıya çevirir
function switchProvider(cfg, provider) {
  save(cfg);
  cfg.provider = provider;
  const raw = readJson(FILE) || {};
  raw.provider = provider;
  writeJson(FILE, raw);
  attach(cfg, provider, raw);
  return cfg;
}

module.exports = { DIR, FILE, keysFile, load, save, loadKeys, saveKeys, switchProvider, GLOBAL_DEFAULTS, PER_PROVIDER };
