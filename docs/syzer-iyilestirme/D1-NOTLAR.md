# D1 kapsam dışı notları

- Bu çalışma ağacında `src/orca-patch.js` bulunmuyor. `app.asar` yama motoru ve
  `quit.log`un gerçek üreticisi, `syzer orca install` tarafından indirilen ayrı
  `SyzerCLI-Orca` eklenti paketidir (`~/.syzercli/orca-plugin/app`). Bu nedenle
  eklentinin mevcut `quit.log` yazımını doğrudan `src/logs.js`ye geçirmek bu
  kartta uygulanmadı. Yeni ortak rotasyon yardımcısı, eklenti deposundaki takip
  kartında `patch.log` ve `quit.log` çağrılarına bağlanmalıdır.
- Orca `app.asar` anchor motorunun yeniden yazımı ve yeni hook olayları bu kartın
  kapsamı dışındadır.
