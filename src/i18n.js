'use strict';

const LANGS = {
  tr: 'Türkçe', en: 'English', de: 'Deutsch', es: 'Español',
  ja: '日本語', zh: '中文', ko: '한국어', pl: 'Polski',
};

const en = {
  lbl_model: 'model', lbl_keys: 'keys', lbl_dir: 'dir', lbl_ctx: 'context', lbl_mode: 'mode',
  keys_summary: '{0} saved · {1} ready · active #{2}',
  perm_ask: 'ask before changes', perm_auto: 'auto-approve', perm_readonly: 'read-only',
  hint: 'Type a message · /help for commands · Ctrl+C stops a reply',
  ctx_summary: '{0} file(s) · {1} skill(s) · {2} command(s)',
  help: `Commands
  /model [id]       show or set the default model
  /models [text]    list free models (optionally filtered) and pick one
  /usage            token / request status of every key
  /keys             list keys · /keys add: paste several keys · /keys use <n>: switch key
  /lang [code]      interface language (tr en de es ja zh ko pl)
  /perm [mode]      ask | auto | readonly
  /skills           list skills and custom commands
  /context          show loaded instruction files
  /clear            clear the conversation
  /exit             quit
  /<skill> [args]   run a skill or .claude command
Tip: pasted text and images appear as [Pasted text #1] / [Image #1]; @path inlines a file.`,
  no_keys: 'No keys saved. Add some: syzer key add <key> [<key> ...]',
  no_usable: 'No usable keys left.{0}',
  earliest: ' Earliest retry: {0}',
  switching: 'key {0} hit its limit ({1}: {2}) — switching to the next key…',
  retrying: 'upstream busy ({0}) — retrying in {1}s…',
  aborted: '[stopped]',
  unknown_cmd: 'Unknown command: {0} (try /help)',
  key_added: '{0} key(s) added. Total: {1}',
  key_dupe: 'Already saved: {0}',
  key_invalid: 'Rejected: {0} — {1}',
  key_none_found: 'No API keys found in the input.',
  key_paste: 'Paste your keys (any format) and press Enter:',
  key_removed: 'Removed: {0}',
  key_bad_index: 'Usage: syzer key remove <number>  (see: key list)',
  key_use_bad: 'Usage: syzer key use <number>  (see: key list)',
  key_active: 'Active key: #{0} {1}',
  key_reset: 'All key states were reset.',
  key_empty: 'No keys saved. Add some: syzer key add <key> ...',
  st_ready: 'ready', st_wait: 'cooldown until {0}', st_off: 'disabled ({0})',
  usage_title: 'Key usage', col_key: 'Key', col_daily: 'Free requests today', col_credit: 'Credit', col_status: 'Status',
  usage_total: 'Free requests left today: {0} / {1}',
  usage_reset: 'Daily free limit resets at 00:00 UTC (local {0}).',
  usage_err: 'unreachable: {0}',
  model_current: 'Default model: {0}', model_set: 'Default model set: {0}',
  model_paid: 'Note: this model was not found in the free list; it may cost credits.',
  model_pick: 'Pick a number (or type text to filter, empty = cancel): ',
  models_title: '{0} free model(s)', models_none: 'No matching free models.',
  lang_set: 'Language set: {0}', lang_bad: 'Supported languages: {0}',
  perm_set: 'Permission mode: {0}', perm_bad: 'Use: ask | auto | readonly',
  confirm_q: 'Allow?', denied: 'Denied by the user.', readonly_block: 'Blocked: read-only mode.',
  skills_none: 'No skills or commands found.', skills_title: 'Skills', cmds_title: 'Commands',
  ctx_none: 'No instruction files found.',
  no_tools: 'This model rejected tool use; continuing as plain chat.',
  img_no_vision: 'This model cannot see images; the image(s) were skipped.',
  img_bad: 'Could not read image: {0}',
  max_iter: 'Stopped: too many tool steps in one turn.',
  thinking: 'thinking', running: 'running {0}', cleared: 'Conversation cleared.',
};

const tr = {
  lbl_model: 'model', lbl_keys: 'key', lbl_dir: 'dizin', lbl_ctx: 'bağlam', lbl_mode: 'mod',
  keys_summary: '{0} kayıtlı · {1} hazır · aktif #{2}',
  perm_ask: 'değişiklikte sor', perm_auto: 'otomatik onay', perm_readonly: 'salt okunur',
  hint: 'Mesaj yaz · komutlar için /help · Ctrl+C yanıtı durdurur',
  ctx_summary: '{0} dosya · {1} skill · {2} komut',
  help: `Komutlar
  /model [id]       varsayılan modeli göster / değiştir
  /models [metin]   free modelleri listele (filtreli) ve seç
  /usage            tüm key'lerin token / istek durumu
  /keys             key'leri listele · /keys add: toplu ekle · /keys use <n>: key değiştir
  /lang [kod]       arayüz dili (tr en de es ja zh ko pl)
  /perm [mod]       ask | auto | readonly
  /skills           skill ve özel komutları listele
  /context          yüklenen talimat dosyalarını göster
  /clear            sohbeti temizle
  /exit             çıkış
  /<skill> [arg]    skill veya .claude komutunu çalıştır
İpucu: yapıştırılan metin ve görseller [Pasted text #1] / [Image #1] olarak görünür; @yol bir dosyayı ekler.`,
  no_keys: 'Kayıtlı key yok. Ekle: syzer key add <key> [<key> ...]',
  no_usable: 'Kullanılabilir key kalmadı.{0}',
  earliest: ' En erken deneme: {0}',
  switching: 'key {0} limite ulaştı ({1}: {2}) — sonraki key\'e geçiliyor…',
  retrying: 'sunucu yoğun ({0}) — {1} sn sonra tekrar denenecek…',
  aborted: '[durduruldu]',
  unknown_cmd: 'Bilinmeyen komut: {0} (/help dene)',
  key_added: '{0} key eklendi. Toplam: {1}',
  key_dupe: 'Zaten kayıtlı: {0}',
  key_invalid: 'Reddedildi: {0} — {1}',
  key_none_found: 'Girdide API key bulunamadı.',
  key_paste: 'Key\'lerini (istediğin formatta) yapıştır ve Enter\'a bas:',
  key_removed: 'Silindi: {0}',
  key_bad_index: 'Kullanım: syzer key remove <numara>  (bkz: key list)',
  key_use_bad: 'Kullanım: syzer key use <numara>  (bkz: key list)',
  key_active: 'Aktif key: #{0} {1}',
  key_reset: 'Tüm key durumları sıfırlandı.',
  key_empty: 'Kayıtlı key yok. Ekle: syzer key add <key> ...',
  st_ready: 'hazır', st_wait: '{0} saatine kadar beklemede', st_off: 'devre dışı ({0})',
  usage_title: 'Key kullanımı', col_key: 'Key', col_daily: 'Bugünkü free istek', col_credit: 'Kredi', col_status: 'Durum',
  usage_total: 'Bugün kalan free istek: {0} / {1}',
  usage_reset: 'Günlük free limit 00:00 UTC\'de sıfırlanır (yerel saat {0}).',
  usage_err: 'ulaşılamadı: {0}',
  model_current: 'Varsayılan model: {0}', model_set: 'Varsayılan model ayarlandı: {0}',
  model_paid: 'Not: bu model free listesinde bulunamadı; kredi harcayabilir.',
  model_pick: 'Numara seç (ya da filtrelemek için yaz, boş = iptal): ',
  models_title: '{0} free model', models_none: 'Eşleşen free model yok.',
  lang_set: 'Dil ayarlandı: {0}', lang_bad: 'Desteklenen diller: {0}',
  perm_set: 'İzin modu: {0}', perm_bad: 'Kullan: ask | auto | readonly',
  confirm_q: 'İzin verilsin mi?', denied: 'Kullanıcı reddetti.', readonly_block: 'Engellendi: salt okunur mod.',
  skills_none: 'Skill veya komut bulunamadı.', skills_title: 'Skill\'ler', cmds_title: 'Komutlar',
  ctx_none: 'Talimat dosyası bulunamadı.',
  no_tools: 'Model araç kullanımını reddetti; düz sohbet olarak devam ediliyor.',
  img_no_vision: 'Bu model görsel göremiyor; görsel(ler) atlandı.',
  img_bad: 'Görsel okunamadı: {0}',
  max_iter: 'Durduruldu: tek turda çok fazla araç adımı.',
  thinking: 'düşünüyor', running: '{0} çalışıyor', cleared: 'Sohbet temizlendi.',
};

const de = {
  ...en,
  keys_summary: '{0} gespeichert · {1} bereit · aktiv #{2}',
  perm_ask: 'vor Änderungen fragen', perm_auto: 'automatisch genehmigen', perm_readonly: 'nur lesen',
  hint: 'Nachricht eingeben · /help für Befehle · Strg+C stoppt die Antwort',
  ctx_summary: '{0} Datei(en) · {1} Skill(s) · {2} Befehl(e)',
  help: `Befehle
  /model [id]       Standardmodell anzeigen / setzen
  /models [Text]    kostenlose Modelle auflisten und wählen
  /usage            Token-/Anfragestatus aller Keys
  /keys             Keys auflisten · /keys add: mehrere einfügen · /keys use <n>: Key wechseln
  /lang [code]      Sprache (tr en de es ja zh ko pl)
  /perm [Modus]     ask | auto | readonly
  /skills           Skills und eigene Befehle
  /context          geladene Anweisungsdateien
  /clear            Unterhaltung löschen
  /exit             beenden
  /<skill> [Args]   Skill oder .claude-Befehl ausführen
Tipp: Eingefügte Texte/Bilder erscheinen als [Pasted text #1] / [Image #1]; @Pfad fügt eine Datei ein.`,
  no_keys: 'Keine Keys gespeichert. Hinzufügen: syzer key add <key> ...',
  no_usable: 'Keine nutzbaren Keys mehr.{0}', earliest: ' Frühestens wieder: {0}',
  switching: 'Key {0} hat sein Limit erreicht ({1}: {2}) — wechsle zum nächsten Key…',
  retrying: 'Server ausgelastet ({0}) — neuer Versuch in {1}s…',
  aborted: '[gestoppt]', unknown_cmd: 'Unbekannter Befehl: {0} (/help)',
  key_added: '{0} Key(s) hinzugefügt. Gesamt: {1}', key_dupe: 'Bereits gespeichert: {0}',
  key_invalid: 'Abgelehnt: {0} — {1}', key_none_found: 'Keine API-Keys in der Eingabe gefunden.',
  key_paste: 'Keys beliebig einfügen und Enter drücken:', key_removed: 'Entfernt: {0}',
  key_bad_index: 'Nutzung: syzer key remove <Nummer>', key_use_bad: 'Nutzung: syzer key use <Nummer>',
  key_active: 'Aktiver Key: #{0} {1}', key_reset: 'Alle Key-Zustände zurückgesetzt.', key_empty: 'Keine Keys gespeichert.',
  st_ready: 'bereit', st_wait: 'Pause bis {0}', st_off: 'deaktiviert ({0})',
  usage_title: 'Key-Nutzung', col_daily: 'Free-Anfragen heute', col_credit: 'Guthaben', col_status: 'Status',
  usage_total: 'Heute verbleibende Free-Anfragen: {0} / {1}',
  usage_reset: 'Tageslimit wird um 00:00 UTC zurückgesetzt (lokal {0}).', usage_err: 'nicht erreichbar: {0}',
  model_current: 'Standardmodell: {0}', model_set: 'Standardmodell gesetzt: {0}',
  model_paid: 'Hinweis: Modell nicht in der Free-Liste; könnte Guthaben kosten.',
  model_pick: 'Nummer wählen (oder Text zum Filtern, leer = abbrechen): ',
  models_title: '{0} kostenlose(s) Modell(e)', models_none: 'Keine passenden Modelle.',
  lang_set: 'Sprache gesetzt: {0}', lang_bad: 'Unterstützte Sprachen: {0}',
  perm_set: 'Berechtigungsmodus: {0}', perm_bad: 'Nutze: ask | auto | readonly',
  confirm_q: 'Erlauben?', denied: 'Vom Benutzer abgelehnt.', readonly_block: 'Blockiert: Nur-Lesen-Modus.',
  skills_none: 'Keine Skills oder Befehle gefunden.', skills_title: 'Skills', cmds_title: 'Befehle',
  ctx_none: 'Keine Anweisungsdateien gefunden.',
  no_tools: 'Modell lehnt Tools ab; weiter als normaler Chat.',
  img_no_vision: 'Dieses Modell kann keine Bilder sehen; Bild(er) übersprungen.', img_bad: 'Bild nicht lesbar: {0}',
  max_iter: 'Gestoppt: zu viele Tool-Schritte.',
  thinking: 'denkt nach', running: '{0} läuft', cleared: 'Unterhaltung gelöscht.',
};

const es = {
  ...en,
  keys_summary: '{0} guardadas · {1} listas · activa #{2}',
  perm_ask: 'preguntar antes de cambiar', perm_auto: 'aprobar automáticamente', perm_readonly: 'solo lectura',
  hint: 'Escribe un mensaje · /help para comandos · Ctrl+C detiene la respuesta',
  ctx_summary: '{0} archivo(s) · {1} skill(s) · {2} comando(s)',
  help: `Comandos
  /model [id]       ver / cambiar el modelo por defecto
  /models [texto]   listar modelos gratuitos y elegir uno
  /usage            estado de tokens / solicitudes de cada key
  /keys             listar keys · /keys add: pegar varias · /keys use <n>: cambiar de key
  /lang [código]    idioma (tr en de es ja zh ko pl)
  /perm [modo]      ask | auto | readonly
  /skills           skills y comandos personalizados
  /context          archivos de instrucciones cargados
  /clear            borrar la conversación
  /exit             salir
  /<skill> [args]   ejecutar un skill o comando .claude
Consejo: el texto/imágenes pegados aparecen como [Pasted text #1] / [Image #1]; @ruta inserta un archivo.`,
  no_keys: 'No hay keys guardadas. Añade: syzer key add <key> ...',
  no_usable: 'No quedan keys utilizables.{0}', earliest: ' Próximo intento: {0}',
  switching: 'la key {0} alcanzó su límite ({1}: {2}) — cambiando a la siguiente…',
  retrying: 'servidor ocupado ({0}) — reintentando en {1}s…',
  aborted: '[detenido]', unknown_cmd: 'Comando desconocido: {0} (/help)',
  key_added: '{0} key(s) añadidas. Total: {1}', key_dupe: 'Ya guardada: {0}',
  key_invalid: 'Rechazada: {0} — {1}', key_none_found: 'No se encontraron API keys.',
  key_paste: 'Pega tus keys (cualquier formato) y pulsa Enter:', key_removed: 'Eliminada: {0}',
  key_bad_index: 'Uso: syzer key remove <número>', key_use_bad: 'Uso: syzer key use <número>',
  key_active: 'Key activa: #{0} {1}', key_reset: 'Estados de las keys restablecidos.', key_empty: 'No hay keys guardadas.',
  st_ready: 'lista', st_wait: 'en pausa hasta {0}', st_off: 'desactivada ({0})',
  usage_title: 'Uso de keys', col_daily: 'Solicitudes free hoy', col_credit: 'Crédito', col_status: 'Estado',
  usage_total: 'Solicitudes free restantes hoy: {0} / {1}',
  usage_reset: 'El límite diario se reinicia a las 00:00 UTC (local {0}).', usage_err: 'inaccesible: {0}',
  model_current: 'Modelo por defecto: {0}', model_set: 'Modelo por defecto: {0}',
  model_paid: 'Nota: no está en la lista gratuita; podría consumir crédito.',
  model_pick: 'Elige un número (o escribe para filtrar, vacío = cancelar): ',
  models_title: '{0} modelo(s) gratuito(s)', models_none: 'Ningún modelo coincide.',
  lang_set: 'Idioma: {0}', lang_bad: 'Idiomas disponibles: {0}',
  perm_set: 'Modo de permisos: {0}', perm_bad: 'Usa: ask | auto | readonly',
  confirm_q: '¿Permitir?', denied: 'Denegado por el usuario.', readonly_block: 'Bloqueado: modo solo lectura.',
  skills_none: 'No hay skills ni comandos.', skills_title: 'Skills', cmds_title: 'Comandos',
  ctx_none: 'No hay archivos de instrucciones.',
  no_tools: 'El modelo rechazó las herramientas; sigo como chat simple.',
  img_no_vision: 'Este modelo no ve imágenes; se omitieron.', img_bad: 'No se pudo leer la imagen: {0}',
  max_iter: 'Detenido: demasiados pasos de herramientas.',
  thinking: 'pensando', running: 'ejecutando {0}', cleared: 'Conversación borrada.',
};

const ja = {
  ...en,
  lbl_model: 'モデル', lbl_keys: 'キー', lbl_dir: '場所', lbl_ctx: '文脈', lbl_mode: 'モード',
  keys_summary: '{0}件保存 · {1}件利用可 · 使用中 #{2}',
  perm_ask: '変更前に確認', perm_auto: '自動承認', perm_readonly: '読み取り専用',
  hint: 'メッセージを入力 · /help でコマンド · Ctrl+C で応答を停止',
  ctx_summary: 'ファイル{0} · スキル{1} · コマンド{2}',
  help: `コマンド
  /model [id]       既定モデルの表示・変更
  /models [文字]    無料モデルの一覧と選択
  /usage            各キーの利用状況
  /keys             キー一覧 · /keys add: 一括追加 · /keys use <n>: キー切替
  /lang [コード]    表示言語 (tr en de es ja zh ko pl)
  /perm [モード]    ask | auto | readonly
  /skills           スキルとカスタムコマンド
  /context          読み込んだ指示ファイル
  /clear            会話をクリア
  /exit             終了
  /<skill> [引数]   スキルまたは .claude コマンドを実行
ヒント: 貼り付けた文章/画像は [Pasted text #1] / [Image #1] と表示され、@パス でファイルを取り込みます。`,
  no_keys: 'キーがありません。追加: syzer key add <key> ...',
  no_usable: '利用可能なキーがありません。{0}', earliest: ' 次の再試行: {0}',
  switching: 'キー {0} が上限に達しました ({1}: {2}) — 次のキーに切り替えます…',
  retrying: 'サーバー混雑 ({0}) — {1}秒後に再試行…',
  aborted: '[停止しました]', unknown_cmd: '不明なコマンド: {0} (/help)',
  key_added: '{0}件のキーを追加しました。合計: {1}', key_dupe: '登録済み: {0}',
  key_invalid: '拒否: {0} — {1}', key_none_found: '入力にAPIキーが見つかりません。',
  key_paste: 'キーを貼り付けて Enter を押してください:', key_removed: '削除しました: {0}',
  key_bad_index: '使い方: syzer key remove <番号>', key_use_bad: '使い方: syzer key use <番号>',
  key_active: '使用中のキー: #{0} {1}', key_reset: 'すべてのキー状態をリセットしました。', key_empty: 'キーがありません。',
  st_ready: '利用可', st_wait: '{0}まで待機', st_off: '無効 ({0})',
  usage_title: 'キー利用状況', col_daily: '本日の無料リクエスト', col_credit: 'クレジット', col_status: '状態',
  usage_total: '本日の残り無料リクエスト: {0} / {1}',
  usage_reset: '無料枠は 00:00 UTC にリセット (現地 {0})。', usage_err: '接続不可: {0}',
  model_current: '既定モデル: {0}', model_set: '既定モデルを設定: {0}',
  model_paid: '注: 無料リストにないモデルです。クレジットを消費する可能性があります。',
  model_pick: '番号を選択 (文字入力で絞り込み、空で取消): ',
  models_title: '無料モデル {0}件', models_none: '一致する無料モデルがありません。',
  lang_set: '言語を設定: {0}', lang_bad: '対応言語: {0}',
  perm_set: '権限モード: {0}', perm_bad: '使い方: ask | auto | readonly',
  confirm_q: '許可しますか?', denied: 'ユーザーが拒否しました。', readonly_block: 'ブロック: 読み取り専用モード。',
  skills_none: 'スキルやコマンドがありません。', skills_title: 'スキル', cmds_title: 'コマンド',
  ctx_none: '指示ファイルがありません。',
  no_tools: 'このモデルはツールを拒否しました。通常のチャットで続行します。',
  img_no_vision: 'このモデルは画像を認識できないため、画像をスキップしました。', img_bad: '画像を読み込めません: {0}',
  max_iter: '停止: 1ターンのツール手順が多すぎます。',
  thinking: '考え中', running: '{0} 実行中', cleared: '会話をクリアしました。',
};

const zh = {
  ...en,
  lbl_model: '模型', lbl_keys: '密钥', lbl_dir: '目录', lbl_ctx: '上下文', lbl_mode: '模式',
  keys_summary: '已保存 {0} 个 · {1} 个可用 · 当前 #{2}',
  perm_ask: '修改前询问', perm_auto: '自动批准', perm_readonly: '只读',
  hint: '输入消息 · /help 查看命令 · Ctrl+C 停止回复',
  ctx_summary: '{0} 个文件 · {1} 个技能 · {2} 个命令',
  help: `命令
  /model [id]       查看或设置默认模型
  /models [文本]    列出免费模型并选择
  /usage            查看每个密钥的用量
  /keys             列出密钥 · /keys add: 批量添加 · /keys use <n>: 切换密钥
  /lang [代码]      界面语言 (tr en de es ja zh ko pl)
  /perm [模式]      ask | auto | readonly
  /skills           技能与自定义命令
  /context          已加载的指令文件
  /clear            清除对话
  /exit             退出
  /<skill> [参数]   运行技能或 .claude 命令
提示: 粘贴的文本/图片显示为 [Pasted text #1] / [Image #1]；@路径 可插入文件。`,
  no_keys: '尚未保存密钥。添加: syzer key add <key> ...',
  no_usable: '没有可用的密钥。{0}', earliest: ' 最早重试时间: {0}',
  switching: '密钥 {0} 已达上限 ({1}: {2}) — 切换到下一个密钥…',
  retrying: '服务器繁忙 ({0}) — {1} 秒后重试…',
  aborted: '[已停止]', unknown_cmd: '未知命令: {0} (/help)',
  key_added: '已添加 {0} 个密钥。总计: {1}', key_dupe: '已存在: {0}',
  key_invalid: '已拒绝: {0} — {1}', key_none_found: '输入中未找到 API 密钥。',
  key_paste: '粘贴密钥（任意格式）后按 Enter:', key_removed: '已删除: {0}',
  key_bad_index: '用法: syzer key remove <编号>', key_use_bad: '用法: syzer key use <编号>',
  key_active: '当前密钥: #{0} {1}', key_reset: '已重置所有密钥状态。', key_empty: '尚未保存密钥。',
  st_ready: '可用', st_wait: '冷却至 {0}', st_off: '已停用 ({0})',
  usage_title: '密钥用量', col_daily: '今日免费请求', col_credit: '额度', col_status: '状态',
  usage_total: '今日剩余免费请求: {0} / {1}',
  usage_reset: '每日免费额度在 00:00 UTC 重置 (本地 {0})。', usage_err: '无法连接: {0}',
  model_current: '默认模型: {0}', model_set: '已设置默认模型: {0}',
  model_paid: '注意: 该模型不在免费列表中，可能消耗额度。',
  model_pick: '选择编号（输入文字筛选，留空取消）: ',
  models_title: '{0} 个免费模型', models_none: '没有匹配的免费模型。',
  lang_set: '语言已设置: {0}', lang_bad: '支持的语言: {0}',
  perm_set: '权限模式: {0}', perm_bad: '用法: ask | auto | readonly',
  confirm_q: '是否允许?', denied: '用户已拒绝。', readonly_block: '已阻止: 只读模式。',
  skills_none: '未找到技能或命令。', skills_title: '技能', cmds_title: '命令',
  ctx_none: '未找到指令文件。',
  no_tools: '该模型拒绝使用工具，将作为普通聊天继续。',
  img_no_vision: '该模型无法识别图片，已跳过图片。', img_bad: '无法读取图片: {0}',
  max_iter: '已停止: 单轮工具步骤过多。',
  thinking: '思考中', running: '正在运行 {0}', cleared: '对话已清除。',
};

const ko = {
  ...en,
  lbl_model: '모델', lbl_keys: '키', lbl_dir: '경로', lbl_ctx: '컨텍스트', lbl_mode: '모드',
  keys_summary: '{0}개 저장 · {1}개 사용 가능 · 사용 중 #{2}',
  perm_ask: '변경 전 확인', perm_auto: '자동 승인', perm_readonly: '읽기 전용',
  hint: '메시지 입력 · /help 로 명령어 · Ctrl+C 로 응답 중지',
  ctx_summary: '파일 {0} · 스킬 {1} · 명령 {2}',
  help: `명령어
  /model [id]       기본 모델 보기/변경
  /models [텍스트]  무료 모델 목록 및 선택
  /usage            각 키의 사용 현황
  /keys             키 목록 · /keys add: 일괄 추가 · /keys use <n>: 키 전환
  /lang [코드]      인터페이스 언어 (tr en de es ja zh ko pl)
  /perm [모드]      ask | auto | readonly
  /skills           스킬 및 사용자 명령
  /context          불러온 지침 파일
  /clear            대화 지우기
  /exit             종료
  /<skill> [인자]   스킬 또는 .claude 명령 실행
팁: 붙여넣은 텍스트/이미지는 [Pasted text #1] / [Image #1] 로 표시되며, @경로 로 파일을 삽입합니다.`,
  no_keys: '저장된 키가 없습니다. 추가: syzer key add <key> ...',
  no_usable: '사용 가능한 키가 없습니다.{0}', earliest: ' 가장 빠른 재시도: {0}',
  switching: '키 {0} 한도 도달 ({1}: {2}) — 다음 키로 전환합니다…',
  retrying: '서버 혼잡 ({0}) — {1}초 후 재시도…',
  aborted: '[중지됨]', unknown_cmd: '알 수 없는 명령: {0} (/help)',
  key_added: '키 {0}개를 추가했습니다. 총 {1}개', key_dupe: '이미 저장됨: {0}',
  key_invalid: '거부됨: {0} — {1}', key_none_found: '입력에서 API 키를 찾지 못했습니다.',
  key_paste: '키를 붙여넣고(형식 무관) Enter 를 누르세요:', key_removed: '삭제됨: {0}',
  key_bad_index: '사용법: syzer key remove <번호>', key_use_bad: '사용법: syzer key use <번호>',
  key_active: '사용 중인 키: #{0} {1}', key_reset: '모든 키 상태를 초기화했습니다.', key_empty: '저장된 키가 없습니다.',
  st_ready: '사용 가능', st_wait: '{0}까지 대기', st_off: '비활성 ({0})',
  usage_title: '키 사용 현황', col_daily: '오늘 무료 요청', col_credit: '크레딧', col_status: '상태',
  usage_total: '오늘 남은 무료 요청: {0} / {1}',
  usage_reset: '일일 무료 한도는 00:00 UTC 에 초기화됩니다 (현지 {0}).', usage_err: '연결 불가: {0}',
  model_current: '기본 모델: {0}', model_set: '기본 모델 설정: {0}',
  model_paid: '참고: 무료 목록에 없는 모델입니다. 크레딧이 소모될 수 있습니다.',
  model_pick: '번호 선택 (텍스트 입력 시 필터, 빈 값 = 취소): ',
  models_title: '무료 모델 {0}개', models_none: '일치하는 무료 모델이 없습니다.',
  lang_set: '언어 설정: {0}', lang_bad: '지원 언어: {0}',
  perm_set: '권한 모드: {0}', perm_bad: '사용법: ask | auto | readonly',
  confirm_q: '허용할까요?', denied: '사용자가 거부했습니다.', readonly_block: '차단됨: 읽기 전용 모드.',
  skills_none: '스킬이나 명령이 없습니다.', skills_title: '스킬', cmds_title: '명령',
  ctx_none: '지침 파일이 없습니다.',
  no_tools: '이 모델이 도구 사용을 거부하여 일반 채팅으로 계속합니다.',
  img_no_vision: '이 모델은 이미지를 볼 수 없어 이미지를 건너뛰었습니다.', img_bad: '이미지를 읽을 수 없음: {0}',
  max_iter: '중지됨: 한 턴에 도구 단계가 너무 많습니다.',
  thinking: '생각 중', running: '{0} 실행 중', cleared: '대화를 지웠습니다.',
};

const pl = {
  ...en,
  lbl_model: 'model', lbl_keys: 'klucze', lbl_dir: 'katalog', lbl_ctx: 'kontekst', lbl_mode: 'tryb',
  keys_summary: '{0} zapisanych · {1} gotowych · aktywny #{2}',
  perm_ask: 'pytaj przed zmianami', perm_auto: 'zatwierdzaj automatycznie', perm_readonly: 'tylko odczyt',
  hint: 'Wpisz wiadomość · /help – komendy · Ctrl+C zatrzymuje odpowiedź',
  ctx_summary: 'plików: {0} · skilli: {1} · komend: {2}',
  help: `Komendy
  /model [id]       pokaż / ustaw domyślny model
  /models [tekst]   lista darmowych modeli i wybór
  /usage            stan zużycia każdego klucza
  /keys             lista kluczy · /keys add: wiele naraz · /keys use <n>: zmień klucz
  /lang [kod]       język interfejsu (tr en de es ja zh ko pl)
  /perm [tryb]      ask | auto | readonly
  /skills           skille i własne komendy
  /context          wczytane pliki instrukcji
  /clear            wyczyść rozmowę
  /exit             wyjście
  /<skill> [arg]    uruchom skill lub komendę .claude
Wskazówka: wklejony tekst/obrazy widać jako [Pasted text #1] / [Image #1]; @ścieżka wstawia plik.`,
  no_keys: 'Brak zapisanych kluczy. Dodaj: syzer key add <key> ...',
  no_usable: 'Brak dostępnych kluczy.{0}', earliest: ' Najwcześniejsza próba: {0}',
  switching: 'klucz {0} osiągnął limit ({1}: {2}) — przełączam na następny…',
  retrying: 'serwer zajęty ({0}) — ponowna próba za {1} s…',
  aborted: '[zatrzymano]', unknown_cmd: 'Nieznana komenda: {0} (/help)',
  key_added: 'Dodano kluczy: {0}. Razem: {1}', key_dupe: 'Już zapisany: {0}',
  key_invalid: 'Odrzucono: {0} — {1}', key_none_found: 'Nie znaleziono kluczy API we wprowadzonym tekście.',
  key_paste: 'Wklej klucze (dowolny format) i naciśnij Enter:', key_removed: 'Usunięto: {0}',
  key_bad_index: 'Użycie: syzer key remove <numer>', key_use_bad: 'Użycie: syzer key use <numer>',
  key_active: 'Aktywny klucz: #{0} {1}', key_reset: 'Zresetowano stany wszystkich kluczy.', key_empty: 'Brak zapisanych kluczy.',
  st_ready: 'gotowy', st_wait: 'przerwa do {0}', st_off: 'wyłączony ({0})',
  usage_title: 'Zużycie kluczy', col_daily: 'Darmowe zapytania dziś', col_credit: 'Kredyt', col_status: 'Stan',
  usage_total: 'Pozostałe darmowe zapytania dziś: {0} / {1}',
  usage_reset: 'Dzienny limit zeruje się o 00:00 UTC (lokalnie {0}).', usage_err: 'niedostępny: {0}',
  model_current: 'Domyślny model: {0}', model_set: 'Ustawiono domyślny model: {0}',
  model_paid: 'Uwaga: modelu nie ma na liście darmowych; może zużywać kredyt.',
  model_pick: 'Wybierz numer (lub wpisz tekst, by filtrować; puste = anuluj): ',
  models_title: 'Darmowe modele: {0}', models_none: 'Brak pasujących darmowych modeli.',
  lang_set: 'Ustawiono język: {0}', lang_bad: 'Obsługiwane języki: {0}',
  perm_set: 'Tryb uprawnień: {0}', perm_bad: 'Użyj: ask | auto | readonly',
  confirm_q: 'Zezwolić?', denied: 'Odrzucone przez użytkownika.', readonly_block: 'Zablokowano: tryb tylko do odczytu.',
  skills_none: 'Brak skilli i komend.', skills_title: 'Skille', cmds_title: 'Komendy',
  ctx_none: 'Brak plików instrukcji.',
  no_tools: 'Model odrzucił narzędzia; kontynuuję jako zwykły czat.',
  img_no_vision: 'Ten model nie widzi obrazów; pominięto obrazy.', img_bad: 'Nie można odczytać obrazu: {0}',
  max_iter: 'Zatrzymano: zbyt wiele kroków narzędzi w jednej turze.',
  thinking: 'myśli', running: 'uruchamiam {0}', cleared: 'Rozmowa wyczyszczona.',
};

const TABLE = { en, tr, de, es, ja, zh, ko, pl };
const NEW = require('./i18n-new');
const NEW2 = require('./i18n-new2');
const NEW3 = require('./i18n-new3');
const NEW4 = require('./i18n-setup');
for (const k of Object.keys(TABLE)) Object.assign(TABLE[k], NEW[k] || {}, NEW2[k] || {}, NEW3[k] || {}, NEW4[k] || {});
let current = 'tr';

function setLang(code) { current = TABLE[code] ? code : 'en'; }
function getLang() { return current; }

function t(key, ...args) {
  const s = (TABLE[current] && TABLE[current][key]) || en[key] || key;
  return s.replace(/\{(\d+)\}/g, (_, i) => (args[i] === undefined ? '' : String(args[i])));
}

module.exports = { LANGS, setLang, getLang, t };
