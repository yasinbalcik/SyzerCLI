'use strict';

// Merkezi boyut limitleri (karakter / kelime). Tüketiciler buradan okur; değerler A0 envanterindeki mevcut sınırlardır.
const LIMITS = Object.freeze({
  instructionFile: 12000, // SYZER.md / CLAUDE.md vb. dosya başına
  mentionFile: 30000, // @dosya ile eklenen içerik
  toolOutput: 20000, // araç çıktısı
  subagentReport: 8000, // alt ajan raporu
  orchestraReport: 3500, // orkestratöre dönen rapor başına
  dependencyContext: 2500, // bağımlı ajana aktarılan rapor başına
  transcript: 60000, // özetlenecek döküm
  summaryWords: 600, // özet isteminde istenen kelime sınırı
});

module.exports = { LIMITS };
