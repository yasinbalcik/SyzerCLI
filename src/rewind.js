'use strict';

// Rewind: seçilen kullanıcı turuna hem konuşmayı hem Syzer'in dosya değişikliklerini geri sarar.
// /undo yalnızca dosyaları geri alır (checkpoints.js), konuşmaya dokunmaz; rewind ikisini birleştirir.
// Tur işareti: session.turnMarks = [{ turn, cp, startLen, prompt, ts }]
//   turn     = oturum içi sıra numarası (kullanıcıya gösterilen)
//   cp       = o turdan itibaren geçerli ilk dosya checkpoint numarası (checkpoints turn >= cp bu veya sonraki turlardır)
//   startLen = o turun kullanıcı mesajının session.messages içindeki indeksi (agent.js runTurn startLen)
// Sıkıştırma (compact) messages dizisini yeniden kurduğu için işaretler mesaj nesne kimliğiyle doğrulanır:
// kullanıcı mesajı ve ondan önceki mesaj aynı indekste aynı nesne değilse işaret geçersizdir ve rewind reddedilir.
const MAX_MARKS = 200;

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return (content.find((p) => p && p.type === 'text') || {}).text || '';
  return '';
}
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 80);

function cpStore(deps) { return (deps && deps.checkpoints) || require('./checkpoints').store(); }

// runTurn'den, kullanıcı mesajı session.messages'a EKLENDİKTEN sonra çağrılır (startLen = ekleme öncesi uzunluk)
function mark(session, startLen, userContent, deps = {}) {
  try {
    const msg = session.messages[startLen];
    if (!msg || msg.role !== 'user') return null;
    if (!Array.isArray(session.turnMarks)) session.turnMarks = [];
    session.turnSeq = (session.turnSeq || 0) + 1;
    let cp = 1;
    try { cp = cpStore(deps).next(session.sessionId); } catch { /* önemsiz */ }
    const m = { turn: session.turnSeq, cp, startLen, prompt: clean(textOf(userContent)), ts: (deps.now || Date.now)() };
    // nesne referansları JSON'a girmesin (oturum kaydı/serileştirme) → numaralandırılamaz alanlar
    Object.defineProperty(m, 'userRef', { value: msg, enumerable: false });
    Object.defineProperty(m, 'prevRef', { value: startLen > 0 ? session.messages[startLen - 1] : null, enumerable: false });
    session.turnMarks.push(m);
    while (session.turnMarks.length > MAX_MARKS) session.turnMarks.shift();
    return m;
  } catch { return null; }
}

const valid = (session, m) => !!m && !!m.userRef && session.messages[m.startLen] === m.userRef &&
  (m.startLen === 0 || session.messages[m.startLen - 1] === m.prevRef);

// Geçerli işaretler (geçersizler ayıklanır)
function marks(session) {
  if (!Array.isArray(session.turnMarks)) session.turnMarks = [];
  session.turnMarks = session.turnMarks.filter((m) => valid(session, m));
  return session.turnMarks.slice();
}

// Bir turu geri sarmanın etkisi (silme yapmadan): { mark, chatTurns, messages, files:[yol], checkpoints }
function preview(session, turn, deps = {}) {
  const all = marks(session);
  const m = all.find((x) => x.turn === Number(turn));
  if (!m) return null;
  const after = all.filter((x) => x.startLen >= m.startLen);
  const cps = cpStore(deps).list(session.sessionId).filter((c) => c.turn >= m.cp);
  const files = [...new Set(cps.flatMap((c) => c.files.map((f) => f.path)))];
  return { mark: m, chatTurns: after.length, messages: session.messages.length - m.startLen, files, checkpoints: cps.length };
}

function rewind(session, turn, { chat = true, files = true, force = false } = {}, deps = {}) {
  const none = { chatTurnsRemoved: 0, files: { restored: [], conflicts: [] } };
  if (session.busy) return { ok: false, error: 'session is busy; wait for the current turn to finish', ...none };
  const pv = preview(session, turn, deps);
  if (!pv) return { ok: false, error: `turn ${turn} not found or no longer valid (conversation was compacted, cleared or resumed)`, ...none };
  if (!chat && !files) return { ok: false, error: 'nothing to do', ...none };
  const res = { ok: true, turn: pv.mark.turn, prompt: pv.mark.prompt, chatTurnsRemoved: 0, files: { restored: [], conflicts: [], skipped: [] } };

  if (files && pv.checkpoints) {
    const r = cpStore(deps).undo(session.sessionId, pv.checkpoints, { force });
    res.files = { restored: r.restored.concat(r.removed), conflicts: r.conflicts, skipped: r.skipped, conflictTurn: r.conflictTurn };
    if (r.conflicts.length && !force) {
      // Çatışma: sohbeti kesme (dosyalar kısmen geri alınmış olabilir; --force ile tekrar denenebilir)
      res.ok = false;
      res.error = 'conflict: files changed after Syzer wrote them; conversation left untouched (use --force to overwrite)';
      return res;
    }
  }
  if (chat) {
    const startLen = pv.mark.startLen;
    session.messages.length = startLen;
    session.turnMarks = (session.turnMarks || []).filter((x) => x.startLen < startLen);
    res.chatTurnsRemoved = pv.chatTurns;
    try { (deps.save || require('./sessions').save)(session); } catch { /* önemsiz */ }
  }
  return res;
}

module.exports = { mark, marks, preview, rewind, valid, MAX_MARKS };
