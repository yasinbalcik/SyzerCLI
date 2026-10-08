'use strict';

// İlk kurulum sihirbazı, güncelleme ve özet kullanım metinleri.
module.exports = {
  en: {
    lbl_steps: 'steps',
    help6: '  /runs · /run <n>           sub-agent runs · full details of one (task, tool calls, report)\n  /web                       open the web UI in the browser',
    web_open: 'Web UI:',
    su_welcome: "Welcome to SyzerCLI! Let's do a quick first-time setup (Enter keeps the default).",
    su_lang: 'Choose your language:', su_choice: 'Your choice',
    su_tutorial: `How it works
  • Pool several API keys per provider; SyzerCLI switches to the next key when one hits its limit.
  • Providers: OpenRouter and NVIDIA — keys are detected from their format.
  • Inside chat: /help lists commands, /usage shows key status, @file inlines a file, /plan plans before acting.
  • Config lives in {0}`,
    su_provider: 'Which provider will you use first?', su_keys: 'Paste your API keys now (any format, blank line to finish, or just Enter to skip):',
    su_perm: 'How should tool actions be approved?', su_perm_ask: 'ask before changes (safest)', su_perm_auto: 'auto-approve', su_perm_readonly: 'read-only',
    su_done: 'Setup complete. Re-run any time with: syzer setup', su_skip_keys: 'No keys added — add later with: syzer key add <key>',
    up_checking: 'Checking for updates…', up_available: 'Update available: v{0} → v{1}', up_downloading: 'Downloading v{0}…',
    up_done: 'Updated to v{0}.', up_current: 'SyzerCLI is up to date (v{0}).', up_failed: 'Update check failed: {0}', up_manual: 'Run: syzer update',
    um_title: 'Total', um_line: '{0}: {1}% used · {2}/{3} keys ready',
  },
  tr: {
    lbl_steps: 'adım',
    help6: '  /runs · /run <no>          alt ajan çalışmaları · birinin tam dökümü (görev, araç çağrıları, rapor)\n  /web                       web arayüzünü tarayıcıda aç',
    web_open: 'Web arayüzü:',
    su_welcome: "SyzerCLI'ye hoş geldin! Kısa bir ilk kurulum yapalım (Enter = varsayılan).",
    su_lang: 'Dilini seç:', su_choice: 'Seçimin',
    su_tutorial: `Nasıl çalışır
  • Her sağlayıcı için birden çok API key havuzlayabilirsin; biri limite takılınca sıradakine geçilir.
  • Sağlayıcılar: OpenRouter ve NVIDIA — key biçiminden otomatik tanınır.
  • Sohbette: /help komutları listeler, /usage key durumunu gösterir, @dosya içeriği ekler, /plan önce plan yapar.
  • Ayarlar şurada: {0}`,
    su_provider: 'İlk olarak hangi sağlayıcıyı kullanacaksın?', su_keys: "API key'lerini yapıştır (her biçim olur, bitirmek için boş satır; atlamak için Enter):",
    su_perm: 'Araç işlemleri nasıl onaylansın?', su_perm_ask: 'değişiklikten önce sor (en güvenlisi)', su_perm_auto: 'otomatik onayla', su_perm_readonly: 'salt okunur',
    su_done: 'Kurulum tamam. İstediğin zaman tekrar: syzer setup', su_skip_keys: 'Key eklenmedi — sonra: syzer key add <key>',
    up_checking: 'Güncelleme kontrol ediliyor…', up_available: 'Güncelleme var: v{0} → v{1}', up_downloading: 'v{0} indiriliyor…',
    up_done: 'v{0} sürümüne güncellendi.', up_current: 'SyzerCLI güncel (v{0}).', up_failed: 'Güncelleme kontrolü başarısız: {0}', up_manual: 'Çalıştır: syzer update',
    um_title: 'Toplam', um_line: '{0}: %{1} kullanıldı · {2}/{3} key hazır',
  },
  de: {
    lbl_steps: 'Schritte',
    web_open: 'Web-Oberfläche:',
    su_welcome: 'Willkommen bei SyzerCLI! Kurze Ersteinrichtung (Enter = Standard).',
    su_lang: 'Sprache wählen:', su_choice: 'Deine Wahl',
    su_tutorial: `So funktioniert es
  • Pro Anbieter mehrere API-Keys bündeln; bei Limit wird zum nächsten Key gewechselt.
  • Anbieter: OpenRouter und NVIDIA — am Key-Format erkannt.
  • Im Chat: /help listet Befehle, /usage zeigt Key-Status, @datei fügt eine Datei ein, /plan plant zuerst.
  • Konfiguration liegt in {0}`,
    su_provider: 'Welchen Anbieter zuerst nutzen?', su_keys: 'API-Keys einfügen (beliebiges Format, leere Zeile = fertig, Enter = überspringen):',
    su_perm: 'Wie sollen Tool-Aktionen bestätigt werden?', su_perm_ask: 'vor Änderungen fragen (am sichersten)', su_perm_auto: 'automatisch', su_perm_readonly: 'nur lesen',
    su_done: 'Einrichtung abgeschlossen. Erneut: syzer setup', su_skip_keys: 'Keine Keys — später: syzer key add <key>',
    up_checking: 'Suche nach Updates…', up_available: 'Update verfügbar: v{0} → v{1}', up_downloading: 'Lade v{0}…',
    up_done: 'Auf v{0} aktualisiert.', up_current: 'SyzerCLI ist aktuell (v{0}).', up_failed: 'Update-Prüfung fehlgeschlagen: {0}', up_manual: 'Ausführen: syzer update',
    um_title: 'Gesamt', um_line: '{0}: {1}% verbraucht · {2}/{3} Keys bereit',
  },
  es: {
    lbl_steps: 'pasos',
    web_open: 'Interfaz web:',
    su_welcome: '¡Bienvenido a SyzerCLI! Configuración inicial rápida (Enter = predeterminado).',
    su_lang: 'Elige tu idioma:', su_choice: 'Tu elección',
    su_tutorial: `Cómo funciona
  • Agrupa varias API keys por proveedor; al llegar al límite pasa a la siguiente.
  • Proveedores: OpenRouter y NVIDIA — se detectan por el formato de la key.
  • En el chat: /help lista comandos, /usage muestra el estado, @archivo inserta un archivo, /plan planifica antes.
  • La configuración está en {0}`,
    su_provider: '¿Qué proveedor usarás primero?', su_keys: 'Pega tus API keys (cualquier formato, línea vacía para terminar, Enter para omitir):',
    su_perm: '¿Cómo aprobar las acciones de herramientas?', su_perm_ask: 'preguntar antes de cambiar (más seguro)', su_perm_auto: 'aprobar automáticamente', su_perm_readonly: 'solo lectura',
    su_done: 'Configuración completa. Repite con: syzer setup', su_skip_keys: 'Sin keys — luego: syzer key add <key>',
    up_checking: 'Buscando actualizaciones…', up_available: 'Actualización disponible: v{0} → v{1}', up_downloading: 'Descargando v{0}…',
    up_done: 'Actualizado a v{0}.', up_current: 'SyzerCLI está al día (v{0}).', up_failed: 'Falló la comprobación: {0}', up_manual: 'Ejecuta: syzer update',
    um_title: 'Total', um_line: '{0}: {1}% usado · {2}/{3} keys listas',
  },
  ja: {
    lbl_steps: 'ステップ',
    web_open: 'Web UI:',
    su_welcome: 'SyzerCLI へようこそ！簡単な初期設定をします（Enter で既定値）。',
    su_lang: '言語を選択:', su_choice: '選択',
    su_tutorial: `使い方
  • プロバイダーごとに複数の API キーをプール。上限に達すると次のキーへ切替。
  • 対応: OpenRouter と NVIDIA — キー形式から自動判別。
  • チャット内: /help でコマンド一覧、/usage でキー状態、@ファイル で内容を挿入、/plan で先に計画。
  • 設定の場所: {0}`,
    su_provider: '最初に使うプロバイダー:', su_keys: 'API キーを貼り付け（形式自由、空行で終了、Enter でスキップ）:',
    su_perm: 'ツール操作の承認方法:', su_perm_ask: '変更前に確認（最も安全）', su_perm_auto: '自動承認', su_perm_readonly: '読み取り専用',
    su_done: '設定完了。再実行: syzer setup', su_skip_keys: 'キー未追加 — 後で: syzer key add <key>',
    up_checking: '更新を確認中…', up_available: '更新あり: v{0} → v{1}', up_downloading: 'v{0} をダウンロード中…',
    up_done: 'v{0} に更新しました。', up_current: '最新です (v{0})。', up_failed: '更新確認に失敗: {0}', up_manual: '実行: syzer update',
    um_title: '合計', um_line: '{0}: {1}% 使用 · {2}/{3} キー利用可',
  },
  zh: {
    lbl_steps: '步',
    web_open: '网页界面：',
    su_welcome: '欢迎使用 SyzerCLI！进行快速初始设置（回车=默认）。',
    su_lang: '选择语言：', su_choice: '你的选择',
    su_tutorial: `使用方式
  • 每个服务商可汇集多个 API 密钥；达到上限时自动切换下一个。
  • 服务商：OpenRouter 和 NVIDIA —— 按密钥格式自动识别。
  • 对话中：/help 列出命令，/usage 显示密钥状态，@文件 插入文件，/plan 先做计划。
  • 配置位置：{0}`,
    su_provider: '先使用哪个服务商？', su_keys: '粘贴 API 密钥（任意格式，空行结束，回车跳过）：',
    su_perm: '工具操作如何批准？', su_perm_ask: '修改前询问（最安全）', su_perm_auto: '自动批准', su_perm_readonly: '只读',
    su_done: '设置完成。可随时重新运行：syzer setup', su_skip_keys: '未添加密钥 —— 之后：syzer key add <key>',
    up_checking: '正在检查更新…', up_available: '有更新：v{0} → v{1}', up_downloading: '正在下载 v{0}…',
    up_done: '已更新到 v{0}。', up_current: 'SyzerCLI 已是最新 (v{0})。', up_failed: '检查更新失败：{0}', up_manual: '运行：syzer update',
    um_title: '总计', um_line: '{0}：已用 {1}% · {2}/{3} 个密钥可用',
  },
  ko: {
    lbl_steps: '단계',
    web_open: '웹 UI:',
    su_welcome: 'SyzerCLI에 오신 것을 환영합니다! 간단한 초기 설정을 진행합니다 (Enter = 기본값).',
    su_lang: '언어 선택:', su_choice: '선택',
    su_tutorial: `사용 방법
  • 제공자별로 여러 API 키를 풀로 관리하며, 한도에 도달하면 다음 키로 전환합니다.
  • 제공자: OpenRouter, NVIDIA — 키 형식으로 자동 인식.
  • 채팅 중: /help 명령 목록, /usage 키 상태, @파일 내용 삽입, /plan 먼저 계획.
  • 설정 위치: {0}`,
    su_provider: '먼저 사용할 제공자:', su_keys: 'API 키를 붙여넣기 (형식 무관, 빈 줄로 종료, Enter로 건너뛰기):',
    su_perm: '도구 작업 승인 방식:', su_perm_ask: '변경 전 확인 (가장 안전)', su_perm_auto: '자동 승인', su_perm_readonly: '읽기 전용',
    su_done: '설정 완료. 다시 실행: syzer setup', su_skip_keys: '키 없음 — 나중에: syzer key add <key>',
    up_checking: '업데이트 확인 중…', up_available: '업데이트 있음: v{0} → v{1}', up_downloading: 'v{0} 다운로드 중…',
    up_done: 'v{0}(으)로 업데이트됨.', up_current: '최신 버전입니다 (v{0}).', up_failed: '업데이트 확인 실패: {0}', up_manual: '실행: syzer update',
    um_title: '합계', um_line: '{0}: {1}% 사용 · 키 {2}/{3} 사용 가능',
  },
  pl: {
    lbl_steps: 'kroków',
    web_open: 'Interfejs WWW:',
    su_welcome: 'Witaj w SyzerCLI! Szybka konfiguracja początkowa (Enter = domyślnie).',
    su_lang: 'Wybierz język:', su_choice: 'Twój wybór',
    su_tutorial: `Jak to działa
  • Pula wielu kluczy API na dostawcę; po osiągnięciu limitu następuje przełączenie na kolejny.
  • Dostawcy: OpenRouter i NVIDIA — rozpoznawani po formacie klucza.
  • W czacie: /help to lista poleceń, /usage status kluczy, @plik wstawia plik, /plan planuje najpierw.
  • Konfiguracja: {0}`,
    su_provider: 'Którego dostawcy użyć najpierw?', su_keys: 'Wklej klucze API (dowolny format, pusta linia kończy, Enter pomija):',
    su_perm: 'Jak zatwierdzać akcje narzędzi?', su_perm_ask: 'pytaj przed zmianami (najbezpieczniej)', su_perm_auto: 'zatwierdzaj automatycznie', su_perm_readonly: 'tylko odczyt',
    su_done: 'Konfiguracja zakończona. Ponownie: syzer setup', su_skip_keys: 'Brak kluczy — później: syzer key add <key>',
    up_checking: 'Sprawdzanie aktualizacji…', up_available: 'Dostępna aktualizacja: v{0} → v{1}', up_downloading: 'Pobieranie v{0}…',
    up_done: 'Zaktualizowano do v{0}.', up_current: 'SyzerCLI jest aktualny (v{0}).', up_failed: 'Sprawdzenie nie powiodło się: {0}', up_manual: 'Uruchom: syzer update',
    um_title: 'Razem', um_line: '{0}: {1}% zużyto · gotowych kluczy {2}/{3}',
  },
};
