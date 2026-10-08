'use strict';

// Üçüncü grup metinler: kurallar, hook'lar, MCP, proxy, git, bağlam, arka plan görevleri.
module.exports = {
  en: {
    blocked_rule: 'Blocked by permission rule: {0}', blocked_danger: 'Blocked: this command looks destructive.',
    hook_blocked: 'Blocked by hook: {0}', rule_added: 'Permanent {0} rule saved: {1}',
    confirm_legend: 'a: allow this session · r: always allow (saves a rule)',
    rules_title: 'Permission rules', rules_none: 'No rules. Add: /allow "Bash(git status:*)"  /deny "Read(.env)"',
    rule_bad: 'Use: <Tool> or <Tool>(pattern), e.g. Bash(npm test:*), Edit(src/**), mcp__server', rule_removed: 'Removed: {0}',
    mcp_title: 'MCP servers', mcp_none: 'No MCP servers configured (.mcp.json or .syzer/mcp.json).',
    mcp_loaded: '{0} MCP server(s) · {1} tool(s)', mcp_fail: 'MCP server "{0}" failed: {1}',
    compact_start: 'Compacting the conversation…', compact_done: 'Compacted: ~{0} → ~{1} tokens', compact_none: 'Nothing to compact yet.',
    git_none: 'This folder is not a git repository.', git_nochanges: 'No changes.',
    commit_msg: 'Commit message:', commit_confirm: 'Commit all changes? [y/n] ', commit_ok: 'Committed: {0}',
    commit_cancel: 'Cancelled.', commit_fail: 'Commit failed: {0}',
    cp_none: 'No checkpoints yet (they are taken before the first change of each turn, in git repos).',
    cp_pick: 'Restore which checkpoint? [1-9, other = cancel]: ', cp_restored: 'Restored the working tree of tracked files to checkpoint {0}.',
    tasks_title: 'Background tasks', tasks_none: 'No background tasks.', task_stopped: 'Stopped task #{0}.',
    todos_none: 'No tasks yet.', init_start: 'Analyzing the project to write SYZER.md…', mem_saved: 'Noted in {0}',
    serve_started: 'listening on {0} (OpenAI-compatible)',
    help4: `  /rules · /allow · /deny   permission rules (saved per project)
  /mcp                      MCP servers and tools
  /compact [focus]          summarize the conversation to free context
  /diff · /commit · /review git helpers
  /checkpoints · /restore   git snapshots taken before changes
  /todos · /tasks           task list · background processes
  /init · # note            create SYZER.md · save a note to it`,
  },
  tr: {
    blocked_rule: 'İzin kuralı engelledi: {0}', blocked_danger: 'Engellendi: bu komut yıkıcı görünüyor.',
    hook_blocked: 'Hook engelledi: {0}', rule_added: 'Kalıcı {0} kuralı kaydedildi: {1}',
    confirm_legend: 'a: bu oturumda izin ver · r: her zaman izin ver (kural kaydeder)',
    rules_title: 'İzin kuralları', rules_none: 'Kural yok. Ekle: /allow "Bash(git status:*)"  /deny "Read(.env)"',
    rule_bad: 'Kullan: <Araç> ya da <Araç>(desen), örn. Bash(npm test:*), Edit(src/**), mcp__sunucu', rule_removed: 'Silindi: {0}',
    mcp_title: 'MCP sunucuları', mcp_none: 'MCP sunucusu tanımlı değil (.mcp.json ya da .syzer/mcp.json).',
    mcp_loaded: '{0} MCP sunucusu · {1} araç', mcp_fail: 'MCP sunucusu "{0}" başlamadı: {1}',
    compact_start: 'Sohbet özetleniyor…', compact_done: 'Özetlendi: ~{0} → ~{1} token', compact_none: 'Henüz özetlenecek bir şey yok.',
    git_none: 'Bu klasör bir git deposu değil.', git_nochanges: 'Değişiklik yok.',
    commit_msg: 'Commit mesajı:', commit_confirm: 'Tüm değişiklikler commit edilsin mi? [y/n] ', commit_ok: 'Commit edildi: {0}',
    commit_cancel: 'İptal edildi.', commit_fail: 'Commit başarısız: {0}',
    cp_none: 'Henüz checkpoint yok (git depolarında her turun ilk değişikliğinden önce alınır).',
    cp_pick: 'Hangi checkpoint\'e dönülsün? [1-9, başka tuş = iptal]: ', cp_restored: 'Takip edilen dosyalar {0} numaralı checkpoint\'e döndürüldü.',
    tasks_title: 'Arka plan görevleri', tasks_none: 'Arka plan görevi yok.', task_stopped: '#{0} numaralı görev durduruldu.',
    todos_none: 'Henüz görev yok.', init_start: 'SYZER.md yazmak için proje inceleniyor…', mem_saved: '{0} dosyasına not edildi',
    serve_started: '{0} adresinde dinliyor (OpenAI uyumlu)',
    help4: `  /rules · /allow · /deny   izin kuralları (projeye kaydedilir)
  /mcp                      MCP sunucuları ve araçları
  /compact [odak]           bağlamı boşaltmak için sohbeti özetle
  /diff · /commit · /review git yardımcıları
  /checkpoints · /restore   değişiklik öncesi alınan git anlık görüntüleri
  /todos · /tasks           görev listesi · arka plan işlemleri
  /init · # not             SYZER.md oluştur · ona not ekle`,
  },
  de: {
    blocked_rule: 'Durch Berechtigungsregel blockiert: {0}', blocked_danger: 'Blockiert: Der Befehl wirkt zerstörerisch.',
    hook_blocked: 'Durch Hook blockiert: {0}', rule_added: 'Dauerhafte {0}-Regel gespeichert: {1}',
    confirm_legend: 'a: für diese Sitzung erlauben · r: immer erlauben (speichert Regel)',
    rules_title: 'Berechtigungsregeln', rules_none: 'Keine Regeln. Hinzufügen: /allow "Bash(git status:*)"  /deny "Read(.env)"',
    rule_bad: 'Nutze: <Tool> oder <Tool>(Muster), z. B. Bash(npm test:*), Edit(src/**), mcp__server', rule_removed: 'Entfernt: {0}',
    mcp_title: 'MCP-Server', mcp_none: 'Keine MCP-Server konfiguriert (.mcp.json oder .syzer/mcp.json).',
    mcp_loaded: '{0} MCP-Server · {1} Tool(s)', mcp_fail: 'MCP-Server "{0}" fehlgeschlagen: {1}',
    compact_start: 'Unterhaltung wird zusammengefasst…', compact_done: 'Zusammengefasst: ~{0} → ~{1} Tokens', compact_none: 'Noch nichts zu komprimieren.',
    git_none: 'Dieser Ordner ist kein Git-Repository.', git_nochanges: 'Keine Änderungen.',
    commit_msg: 'Commit-Nachricht:', commit_confirm: 'Alle Änderungen committen? [y/n] ', commit_ok: 'Committed: {0}',
    commit_cancel: 'Abgebrochen.', commit_fail: 'Commit fehlgeschlagen: {0}',
    cp_none: 'Noch keine Checkpoints (vor der ersten Änderung je Runde in Git-Repos).',
    cp_pick: 'Welcher Checkpoint? [1-9, sonst = abbrechen]: ', cp_restored: 'Verfolgte Dateien auf Checkpoint {0} zurückgesetzt.',
    tasks_title: 'Hintergrundaufgaben', tasks_none: 'Keine Hintergrundaufgaben.', task_stopped: 'Aufgabe #{0} gestoppt.',
    todos_none: 'Noch keine Aufgaben.', init_start: 'Projekt wird analysiert, um SYZER.md zu schreiben…', mem_saved: 'Notiert in {0}',
    serve_started: 'lauscht auf {0} (OpenAI-kompatibel)',
    help4: `  /rules · /allow · /deny   Berechtigungsregeln (pro Projekt gespeichert)
  /mcp                      MCP-Server und Tools
  /compact [Fokus]          Unterhaltung zusammenfassen, um Kontext freizugeben
  /diff · /commit · /review Git-Helfer
  /checkpoints · /restore   Git-Snapshots vor Änderungen
  /todos · /tasks           Aufgabenliste · Hintergrundprozesse
  /init · # Notiz           SYZER.md erstellen · Notiz speichern`,
  },
  es: {
    blocked_rule: 'Bloqueado por regla de permisos: {0}', blocked_danger: 'Bloqueado: el comando parece destructivo.',
    hook_blocked: 'Bloqueado por hook: {0}', rule_added: 'Regla {0} permanente guardada: {1}',
    confirm_legend: 'a: permitir en esta sesión · r: permitir siempre (guarda una regla)',
    rules_title: 'Reglas de permisos', rules_none: 'Sin reglas. Añade: /allow "Bash(git status:*)"  /deny "Read(.env)"',
    rule_bad: 'Usa: <Herramienta> o <Herramienta>(patrón), p. ej. Bash(npm test:*), Edit(src/**), mcp__servidor', rule_removed: 'Eliminada: {0}',
    mcp_title: 'Servidores MCP', mcp_none: 'No hay servidores MCP configurados (.mcp.json o .syzer/mcp.json).',
    mcp_loaded: '{0} servidor(es) MCP · {1} herramienta(s)', mcp_fail: 'El servidor MCP "{0}" falló: {1}',
    compact_start: 'Resumiendo la conversación…', compact_done: 'Resumido: ~{0} → ~{1} tokens', compact_none: 'Aún no hay nada que resumir.',
    git_none: 'Esta carpeta no es un repositorio git.', git_nochanges: 'Sin cambios.',
    commit_msg: 'Mensaje de commit:', commit_confirm: '¿Hacer commit de todos los cambios? [y/n] ', commit_ok: 'Commit hecho: {0}',
    commit_cancel: 'Cancelado.', commit_fail: 'Falló el commit: {0}',
    cp_none: 'Aún no hay checkpoints (se crean antes del primer cambio de cada turno, en repos git).',
    cp_pick: '¿Qué checkpoint restaurar? [1-9, otra = cancelar]: ', cp_restored: 'Archivos rastreados restaurados al checkpoint {0}.',
    tasks_title: 'Tareas en segundo plano', tasks_none: 'No hay tareas en segundo plano.', task_stopped: 'Tarea #{0} detenida.',
    todos_none: 'Aún no hay tareas.', init_start: 'Analizando el proyecto para escribir SYZER.md…', mem_saved: 'Anotado en {0}',
    serve_started: 'escuchando en {0} (compatible con OpenAI)',
    help4: `  /rules · /allow · /deny   reglas de permisos (por proyecto)
  /mcp                      servidores MCP y herramientas
  /compact [enfoque]        resumir la conversación para liberar contexto
  /diff · /commit · /review utilidades git
  /checkpoints · /restore   instantáneas git previas a los cambios
  /todos · /tasks           lista de tareas · procesos en segundo plano
  /init · # nota            crear SYZER.md · guardar una nota`,
  },
  ja: {
    blocked_rule: '権限ルールによりブロック: {0}', blocked_danger: 'ブロック: 破壊的なコマンドと判断しました。',
    hook_blocked: 'フックによりブロック: {0}', rule_added: '恒久的な {0} ルールを保存: {1}',
    confirm_legend: 'a: このセッションで許可 · r: 常に許可 (ルールを保存)',
    rules_title: '権限ルール', rules_none: 'ルールなし。追加: /allow "Bash(git status:*)"  /deny "Read(.env)"',
    rule_bad: '使い方: <ツール> または <ツール>(パターン) 例: Bash(npm test:*), Edit(src/**), mcp__server', rule_removed: '削除: {0}',
    mcp_title: 'MCPサーバー', mcp_none: 'MCPサーバーが未設定です (.mcp.json または .syzer/mcp.json)。',
    mcp_loaded: 'MCPサーバー{0}件 · ツール{1}件', mcp_fail: 'MCPサーバー "{0}" の起動に失敗: {1}',
    compact_start: '会話を要約中…', compact_done: '要約しました: ~{0} → ~{1} トークン', compact_none: 'まだ要約する内容がありません。',
    git_none: 'このフォルダはgitリポジトリではありません。', git_nochanges: '変更なし。',
    commit_msg: 'コミットメッセージ:', commit_confirm: 'すべての変更をコミットしますか? [y/n] ', commit_ok: 'コミットしました: {0}',
    commit_cancel: 'キャンセルしました。', commit_fail: 'コミット失敗: {0}',
    cp_none: 'チェックポイントはまだありません (gitリポジトリで各ターンの最初の変更前に作成)。',
    cp_pick: 'どのチェックポイントに戻しますか? [1-9、他のキー = 取消]: ', cp_restored: '追跡中のファイルをチェックポイント {0} に戻しました。',
    tasks_title: 'バックグラウンドタスク', tasks_none: 'バックグラウンドタスクはありません。', task_stopped: 'タスク #{0} を停止しました。',
    todos_none: 'タスクはまだありません。', init_start: 'SYZER.md を書くためにプロジェクトを解析中…', mem_saved: '{0} にメモしました',
    serve_started: '{0} で待機中 (OpenAI互換)',
    help4: `  /rules · /allow · /deny   権限ルール (プロジェクトごとに保存)
  /mcp                      MCPサーバーとツール
  /compact [重点]           会話を要約してコンテキストを空ける
  /diff · /commit · /review gitヘルパー
  /checkpoints · /restore   変更前に取るgitスナップショット
  /todos · /tasks           タスク一覧 · バックグラウンド処理
  /init · # メモ            SYZER.md を作成 · メモを追記`,
  },
  zh: {
    blocked_rule: '被权限规则阻止: {0}', blocked_danger: '已阻止: 该命令看起来具有破坏性。',
    hook_blocked: '被 hook 阻止: {0}', rule_added: '已保存永久 {0} 规则: {1}',
    confirm_legend: 'a: 本次会话允许 · r: 始终允许（保存规则）',
    rules_title: '权限规则', rules_none: '暂无规则。添加: /allow "Bash(git status:*)"  /deny "Read(.env)"',
    rule_bad: '用法: <工具> 或 <工具>(模式)，例如 Bash(npm test:*)、Edit(src/**)、mcp__server', rule_removed: '已删除: {0}',
    mcp_title: 'MCP 服务器', mcp_none: '未配置 MCP 服务器（.mcp.json 或 .syzer/mcp.json）。',
    mcp_loaded: '{0} 个 MCP 服务器 · {1} 个工具', mcp_fail: 'MCP 服务器 "{0}" 启动失败: {1}',
    compact_start: '正在总结对话…', compact_done: '已总结: ~{0} → ~{1} tokens', compact_none: '暂时没有可总结的内容。',
    git_none: '此文件夹不是 git 仓库。', git_nochanges: '没有更改。',
    commit_msg: '提交信息:', commit_confirm: '提交所有更改？[y/n] ', commit_ok: '已提交: {0}',
    commit_cancel: '已取消。', commit_fail: '提交失败: {0}',
    cp_none: '还没有检查点（在 git 仓库中，每轮第一次更改前创建）。',
    cp_pick: '恢复哪个检查点？[1-9，其他键 = 取消]: ', cp_restored: '已将受跟踪文件恢复到检查点 {0}。',
    tasks_title: '后台任务', tasks_none: '没有后台任务。', task_stopped: '已停止任务 #{0}。',
    todos_none: '还没有任务。', init_start: '正在分析项目以编写 SYZER.md…', mem_saved: '已记录到 {0}',
    serve_started: '正在监听 {0}（兼容 OpenAI）',
    help4: `  /rules · /allow · /deny   权限规则（按项目保存）
  /mcp                      MCP 服务器与工具
  /compact [重点]           总结对话以释放上下文
  /diff · /commit · /review git 助手
  /checkpoints · /restore   更改前的 git 快照
  /todos · /tasks           任务列表 · 后台进程
  /init · # 笔记            创建 SYZER.md · 保存笔记`,
  },
  ko: {
    blocked_rule: '권한 규칙에 의해 차단됨: {0}', blocked_danger: '차단됨: 파괴적인 명령으로 보입니다.',
    hook_blocked: 'hook 에 의해 차단됨: {0}', rule_added: '영구 {0} 규칙 저장됨: {1}',
    confirm_legend: 'a: 이번 세션 허용 · r: 항상 허용 (규칙 저장)',
    rules_title: '권한 규칙', rules_none: '규칙 없음. 추가: /allow "Bash(git status:*)"  /deny "Read(.env)"',
    rule_bad: '사용법: <도구> 또는 <도구>(패턴), 예: Bash(npm test:*), Edit(src/**), mcp__server', rule_removed: '삭제됨: {0}',
    mcp_title: 'MCP 서버', mcp_none: '설정된 MCP 서버가 없습니다 (.mcp.json 또는 .syzer/mcp.json).',
    mcp_loaded: 'MCP 서버 {0}개 · 도구 {1}개', mcp_fail: 'MCP 서버 "{0}" 실패: {1}',
    compact_start: '대화를 요약하는 중…', compact_done: '요약됨: ~{0} → ~{1} 토큰', compact_none: '아직 요약할 내용이 없습니다.',
    git_none: '이 폴더는 git 저장소가 아닙니다.', git_nochanges: '변경 사항 없음.',
    commit_msg: '커밋 메시지:', commit_confirm: '모든 변경 사항을 커밋할까요? [y/n] ', commit_ok: '커밋됨: {0}',
    commit_cancel: '취소됨.', commit_fail: '커밋 실패: {0}',
    cp_none: '체크포인트가 아직 없습니다 (git 저장소에서 각 턴의 첫 변경 전에 생성).',
    cp_pick: '어느 체크포인트로 복원할까요? [1-9, 다른 키 = 취소]: ', cp_restored: '추적 파일을 체크포인트 {0} 으로 복원했습니다.',
    tasks_title: '백그라운드 작업', tasks_none: '백그라운드 작업이 없습니다.', task_stopped: '작업 #{0} 을 중지했습니다.',
    todos_none: '아직 작업이 없습니다.', init_start: 'SYZER.md 작성을 위해 프로젝트 분석 중…', mem_saved: '{0} 에 기록함',
    serve_started: '{0} 에서 대기 중 (OpenAI 호환)',
    help4: `  /rules · /allow · /deny   권한 규칙 (프로젝트별 저장)
  /mcp                      MCP 서버와 도구
  /compact [초점]           대화를 요약해 컨텍스트 확보
  /diff · /commit · /review git 도우미
  /checkpoints · /restore   변경 전 git 스냅샷
  /todos · /tasks           작업 목록 · 백그라운드 프로세스
  /init · # 메모            SYZER.md 생성 · 메모 저장`,
  },
  pl: {
    blocked_rule: 'Zablokowane regułą uprawnień: {0}', blocked_danger: 'Zablokowano: polecenie wygląda na destrukcyjne.',
    hook_blocked: 'Zablokowane przez hook: {0}', rule_added: 'Zapisano stałą regułę {0}: {1}',
    confirm_legend: 'a: zezwól w tej sesji · r: zawsze zezwalaj (zapisuje regułę)',
    rules_title: 'Reguły uprawnień', rules_none: 'Brak reguł. Dodaj: /allow "Bash(git status:*)"  /deny "Read(.env)"',
    rule_bad: 'Użyj: <Narzędzie> lub <Narzędzie>(wzorzec), np. Bash(npm test:*), Edit(src/**), mcp__serwer', rule_removed: 'Usunięto: {0}',
    mcp_title: 'Serwery MCP', mcp_none: 'Brak skonfigurowanych serwerów MCP (.mcp.json lub .syzer/mcp.json).',
    mcp_loaded: 'Serwery MCP: {0} · narzędzia: {1}', mcp_fail: 'Serwer MCP "{0}" nie wystartował: {1}',
    compact_start: 'Podsumowuję rozmowę…', compact_done: 'Podsumowano: ~{0} → ~{1} tokenów', compact_none: 'Nie ma jeszcze czego podsumowywać.',
    git_none: 'Ten katalog nie jest repozytorium git.', git_nochanges: 'Brak zmian.',
    commit_msg: 'Komunikat commita:', commit_confirm: 'Zatwierdzić wszystkie zmiany? [y/n] ', commit_ok: 'Zatwierdzono: {0}',
    commit_cancel: 'Anulowano.', commit_fail: 'Commit nieudany: {0}',
    cp_none: 'Brak punktów kontrolnych (tworzone przed pierwszą zmianą w turze, w repozytoriach git).',
    cp_pick: 'Który punkt przywrócić? [1-9, inny = anuluj]: ', cp_restored: 'Przywrócono śledzone pliki do punktu {0}.',
    tasks_title: 'Zadania w tle', tasks_none: 'Brak zadań w tle.', task_stopped: 'Zatrzymano zadanie #{0}.',
    todos_none: 'Brak zadań.', init_start: 'Analizuję projekt, aby napisać SYZER.md…', mem_saved: 'Zapisano w {0}',
    serve_started: 'nasłuchuje na {0} (zgodny z OpenAI)',
    help4: `  /rules · /allow · /deny   reguły uprawnień (zapisywane w projekcie)
  /mcp                      serwery MCP i narzędzia
  /compact [fokus]          podsumuj rozmowę, by zwolnić kontekst
  /diff · /commit · /review pomocniki git
  /checkpoints · /restore   migawki git sprzed zmian
  /todos · /tasks           lista zadań · procesy w tle
  /init · # notatka         utwórz SYZER.md · zapisz notatkę`,
  },
};
