'use strict';
// Key havuzu sağlık takibi: key başına son N sonuç + ardışık 429/5xx için üstel soğuma.
// Dosya: ~/.syzercli/key-health.json. Tam key ASLA yazılmaz; key'ler kısa parmak izi (mask) ile tanınır.
const fs = require('fs');
const path = require('path');
const os = require('os');

const DIR = process.env.SYZER_HOME || path.join(os.homedir(), '.syzercli');
const FILE = path.join(DIR, 'key-health.json');
const N = 20;
const COOLDOWNS = [30e3, 120e3, 600e3]; // 30 sn, 2 dk, 10 dk (üst sınır)
const MIN_SAMPLES = 3; // bundan az örnekte hata oranı 0 sayılır (yeni key haksız cezalanmasın)

// outcome: 'ok' | '401' | '403' | '429' | '5xx' | 'network'
function classify(status, message) {
  if (/^network:/i.test(message || '')) return 'network';
  if (status === 401 || status === 403 || status === 429) return String(status);
  if (status >= 500) return '5xx';
  return null; // 400/402/404…: key sağlığıyla ilgisiz
}

function create({ file = FILE, now = Date.now, fsImpl = fs } = {}) {
  const read = () => { try { const j = JSON.parse(fsImpl.readFileSync(file, 'utf8')); return j && typeof j === 'object' ? j : {}; } catch { return {}; } };
  const write = (db) => {
    fsImpl.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fsImpl.writeFileSync(tmp, JSON.stringify(db), { mode: 0o600 });
    fsImpl.renameSync(tmp, file);
  };
  const id = (provider, fp) => `${provider}:${fp}`;

  // Asla fırlatmaz. Her çağrıda dosyayı yeniden okur (paralel süreçler birbirini ezmesin).
  function recordOutcome(provider, fp, outcome) {
    try {
      if (!provider || !fp || !outcome) return;
      const db = read();
      const e = db[id(provider, fp)] || { outcomes: [], streak: 0, coolUntil: 0 };
      const t = now();
      e.outcomes.push({ t, o: outcome });
      if (e.outcomes.length > N) e.outcomes = e.outcomes.slice(-N);
      if (outcome === 'ok') { e.streak = 0; e.coolUntil = 0; }
      else if (outcome === '429' || outcome === '5xx') {
        e.streak = (e.streak | 0) + 1;
        e.coolUntil = t + COOLDOWNS[Math.min(e.streak, COOLDOWNS.length) - 1];
      }
      db[id(provider, fp)] = e;
      write(db);
    } catch { /* sağlık takibi asla isteği bozmaz */ }
  }

  const failRate = (e) => {
    if (!e || !e.outcomes || e.outcomes.length < MIN_SAMPLES) return 0;
    return e.outcomes.filter((x) => x.o !== 'ok').length / e.outcomes.length;
  };

  // Seçim için anlık görüntü: dosya bir kez okunur. get(provider, fp) => { rate, cooling, coolLeft }
  function snapshot() {
    const db = read(); const t = now();
    const has = Object.keys(db).length > 0;
    return {
      has,
      get(provider, fp) {
        const e = db[id(provider, fp)];
        const left = e && e.coolUntil > t ? e.coolUntil - t : 0;
        return { rate: failRate(e), cooling: left > 0, coolLeft: left };
      },
    };
  }

  // list: key girdileri (mevcut sıra). Soğuyanlar sona, kalanlar hata oranı kovasına (0.25) göre kararlı sıralanır.
  // İstatistik yoksa listeyi aynen döndürür (eski davranış).
  function rank(provider, list, fpOf) {
    const s = snapshot();
    if (!s.has) return list;
    const info = list.map((e, i) => ({ e, i, ...s.get(provider, fpOf(e.key)) }));
    info.sort((a, b) => (a.cooling - b.cooling) || (Math.round(a.rate * 4) - Math.round(b.rate * 4)) || (a.i - b.i));
    return info.map((x) => x.e);
  }

  const isCooling = (provider, fp) => snapshot().get(provider, fp).cooling;

  function stats(provider, fp) {
    const e = read()[id(provider, fp)];
    const g = snapshot().get(provider, fp);
    const counts = {};
    for (const x of (e && e.outcomes) || []) counts[x.o] = (counts[x.o] || 0) + 1;
    return { samples: e ? e.outcomes.length : 0, counts, last: e && e.outcomes.length ? e.outcomes[e.outcomes.length - 1] : null, rate: g.rate, coolLeft: g.coolLeft, streak: e ? e.streak | 0 : 0 };
  }

  return { recordOutcome, rank, snapshot, isCooling, stats, file };
}

const shared = create();
module.exports = { create, classify, N, COOLDOWNS, MIN_SAMPLES, ...shared, shared };
