'use strict';

// Dosya checkpoint'leri: Syzer'in kendi dosya araçları (write_file / edit_file) bir dosyayı değiştirmeden önce
// eski içeriği <DIR>/checkpoints/<sessionId>/ altına yazar. Bir checkpoint = bir kullanıcı turu.
// Kapsam: yalnızca Syzer'in dosya araçları; kabuk komutlarının yan etkileri izlenmez, git'e dokunulmaz.
// Süreç içi alt ajanlar aynı checkpoint'e yazar; Orca işçileri (ayrı süreç) izlenmez.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

const MAX_KEEP = 30;
const MAX_FILE = 5 * 1024 * 1024;
const NL = String.fromCharCode(10);

const sha = (buf) => crypto.createHash('sha1').update(buf).digest('hex');

function create({ dir = path.join(config.DIR, 'checkpoints'), fsImpl = fs, now = Date.now, maxKeep = MAX_KEEP, maxFile = MAX_FILE } = {}) {
  const sdir = (sid) => path.join(dir, String(sid));
  const idxFile = (sid) => path.join(sdir(sid), 'index.json');
  const pending = new Map(); // sessionId -> kullanıcı isteğinin başı (tur henüz dosya değiştirmediyse)
  const open = new Map();    // sessionId -> bu turun checkpoint'i (ilk kayıtta açılır)

  function writeAtomic(file, data) {
    fsImpl.mkdirSync(path.dirname(file), { recursive: true });
    fsImpl.writeFileSync(`${file}.tmp`, data);
    fsImpl.renameSync(`${file}.tmp`, file);
  }
  function load(sid) {
    try { const j = JSON.parse(String(fsImpl.readFileSync(idxFile(sid)))); return Array.isArray(j.turns) ? j : { turns: [], next: 1 }; } catch { return { turns: [], next: 1 }; }
  }
  const save = (sid, idx) => writeAtomic(idxFile(sid), JSON.stringify(idx, null, 2) + NL);
  const rm = (p) => { try { fsImpl.rmSync(p, { recursive: true, force: true }); } catch { /* önemsiz */ } };
  const readBuf = (p) => { try { return fsImpl.readFileSync(p); } catch { return null; } };

  // Yeni kullanıcı turu başlar: önceki turun açık checkpoint'i kapanır
  function beginTurn(sid, prompt) {
    open.delete(sid);
    pending.set(sid, String(prompt || '').replace(/\s+/g, ' ').trim().slice(0, 80));
  }

  // Dosya değişmeden hemen önce çağrılır
  function record(sid, file) {
    if (!sid) return;
    try {
      const idx = load(sid);
      let cp = open.get(sid) && idx.turns.find((x) => x.turn === open.get(sid));
      if (!cp) {
        cp = { turn: idx.next++, ts: now(), prompt: pending.get(sid) || '', files: [] };
        idx.turns.push(cp);
        open.set(sid, cp.turn);
        while (idx.turns.length > maxKeep) { const old = idx.turns.shift(); rm(path.join(sdir(sid), String(old.turn))); }
      }
      if (cp.files.some((f) => f.path === file)) return save(sid, idx); // ilk (en eski) içerik korunur
      const entry = { path: file };
      let st = null;
      try { st = fsImpl.statSync(file); } catch { /* dosya yok */ }
      if (!st) entry.existed = false;
      else if (st.size > maxFile) { entry.existed = true; entry.skipped = 'too large'; }
      else {
        const buf = readBuf(file);
        if (buf === null) entry.existed = false;
        else {
          entry.existed = true;
          entry.blob = `${cp.files.length}.bak`;
          entry.hash = sha(buf);
          writeAtomic(path.join(sdir(sid), String(cp.turn), entry.blob), buf);
        }
      }
      cp.files.push(entry);
      save(sid, idx);
    } catch { /* checkpoint hatası araçları engellemesin */ }
  }

  // Dosya yazıldıktan sonra: Syzer'in bıraktığı içeriğin özeti (çakışma tespiti için)
  function wrote(sid, file) {
    if (!sid) return;
    try {
      const idx = load(sid);
      const cp = idx.turns.find((x) => x.turn === open.get(sid));
      const f = cp && cp.files.find((x) => x.path === file);
      if (!f) return;
      const buf = readBuf(file);
      f.after = buf === null ? null : sha(buf);
      try { f.mtime = fsImpl.statSync(file).mtimeMs; } catch { /* önemsiz */ }
      save(sid, idx);
    } catch { /* önemsiz */ }
  }

  const list = (sid) => load(sid).turns.slice();

  // Son n checkpoint'i (yeniden eskiye) geri yükler. Çakışmada force yoksa durur.
  function undo(sid, n = 1, { force = false } = {}) {
    const idx = load(sid);
    const res = { restored: [], removed: [], skipped: [], conflicts: [], turns: 0 };
    for (let i = 0; i < n && idx.turns.length; i++) {
      const cp = idx.turns[idx.turns.length - 1];
      const conflicts = [];
      for (const f of cp.files) {
        if (f.skipped || f.after === undefined) continue;
        const cur = readBuf(f.path);
        const curHash = cur === null ? null : sha(cur);
        if (curHash !== f.after) conflicts.push(f.path);
      }
      if (conflicts.length && !force) { res.conflicts = conflicts; res.conflictTurn = cp.turn; break; }
      for (const f of cp.files) {
        if (f.skipped) { res.skipped.push({ path: f.path, why: f.skipped }); continue; }
        try {
          if (f.existed) {
            const blob = fsImpl.readFileSync(path.join(sdir(sid), String(cp.turn), f.blob));
            fsImpl.mkdirSync(path.dirname(f.path), { recursive: true });
            fsImpl.writeFileSync(f.path, blob);
            res.restored.push(f.path);
          } else {
            fsImpl.rmSync(f.path, { force: true });
            res.removed.push(f.path);
          }
        } catch (e) { res.skipped.push({ path: f.path, why: e.message }); }
      }
      idx.turns.pop();
      rm(path.join(sdir(sid), String(cp.turn)));
      res.turns++;
    }
    save(sid, idx);
    open.delete(sid);
    return res;
  }

  return { beginTurn, record, wrote, list, undo, dir };
}

let shared = null;
const store = () => shared || (shared = create());

module.exports = { create, store, MAX_KEEP, MAX_FILE };
