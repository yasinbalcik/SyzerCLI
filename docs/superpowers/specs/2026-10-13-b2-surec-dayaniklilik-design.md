# B2 Süreç Dayanıklılığı Tasarımı

**Tarih:** 2026-10-13  
**Kart:** B2 — Windows süreç dayanıklılığı  
**Durum:** Uygulanmak üzere onaylı

## Amaç ve sınır

Bu kart, kabuk/MCP çocuk süreçlerinin doğru kodlama ile başlatılmasını ve kapatıldığında tüm süreç ağacının sonlanmasını sağlar. Ayrıca kuyrukta bekleyen alt ajanların iptalini ve key-health durum dosyasının Windows kilitlerine dayanıklı atomik yazımını kapsar. Mevcut `ERR_<CODE>` metinleri, headless JSON çıktısı, `limits.js`, `atomic-json.js` arayüzü ve B1 çalışma alanı güvenliği değişmez.

Kapsam dışı: orkestra dalgasındaki aynı dosya yazma çakışması ve `run_command` ile çalışma alanı dışına yazma koruması. Bunlar B2 tarafından uygulanmaz; kart notlarında Yasin için kaydedilir.

## Kararlar

1. Yeni `src/proc.js`, saf olarak test edilebilir süreç ilkelerini tek yerde tutar. `tools.js` ve `mcp.js` yalnızca bu yardımcıyı çağırır; terminal görünümü değişmez.
2. Windows kabuk komutu önce `pwsh.exe` bulunabiliyorsa onunla, aksi halde `powershell.exe` ile başlar. Her iki durumda da profil yüklenmez ve komuttan önce `[Console]::InputEncoding`, `[Console]::OutputEncoding` ve `$OutputEncoding` BOM'suz UTF-8 yapılır. Böylece Türkçe stdout/stderr Node'a UTF-8 olarak ulaşır. Bulma işlemi başarısızsa geriye uyumlu Windows PowerShell seçilir.
3. POSIX kabukları `detached: true` ile kendi süreç grubunda başlar. Kapatmada grup önce `SIGTERM`, kısa bir zarif-kapanış süresinden sonra hâlâ canlıysa `SIGKILL` alır. Windows'ta `taskkill /pid <pid> /t /f` başlatılır; hem eşzamanlı fırlatma hem `error` olayı yutulur, dolayısıyla kapatma yolu hata üretmez.
4. MCP'nin Windows başlatması doğrudan `cmd.exe /d /s /c` kullanır. Komut ve her argüman güvenli şekilde alıntılanır; boşluk, tırnak ve cmd metakarakterleri tek argüman sınırında kalır. MCP istemcisi de süreç ağacı yardımcısıyla kapanır. POSIX MCP çocukları da ayrı grup olarak başlatılır.
5. `limited(max, fn, signal)` kapı beklerken `AbortSignal` dinler. İptal, kuyruğa alınmış bekleyiciyi çıkarır, `AbortError` ile hemen reddeder ve daha sonra kapasite açıldığında iptal edilmiş işi çalıştırmaz. Çağrı öncesinde iptal edilmiş sinyal de aynı sonucu verir. Etkin işlerin mevcut `runTurn` iptal zinciri korunur.
6. `key-health.js`, biçimi bozmamak için kompakt JSON (`space: 0`, son satır yok) ile mevcut `writeJsonAtomic` yardımcısını kullanır. Bu helper'ın `EPERM`/`EBUSY` yeniden denemesi ve geçici dosya temizliği korunur; key-health hâlâ hata fırlatmaz.

## Doğrulama planı (TDD)

- `test/proc.test.js`: UTF-8 PowerShell ön eki/pwsh tercihi, POSIX detached süreç grubu ve TERM/KILL, Windows `taskkill` hata dinleyicisi.
- `test/mcp.test.js`: `cmd.exe` komut satırı alıntılama ve `close()` ile süreç ağacı kapatma.
- `test/subagents-abort.test.js`: kuyruktaki ve önceden iptal edilmiş bekleyici davranışı.
- `test/key-health.test.js`: key-health yazımının atomik helper üzerinden Windows yeniden denemesini kullandığı ve biçimi koruduğu.
- Tam `npm test`: mevcut test listesiyle birlikte yeni üç dosyayı çalıştırır.

## Kabul ölçütleri

- Windows kabuk/MCP kapanışı yetim çocuk bırakmaz; kapatma hatası kullanıcı çıktısına sızmaz.
- POSIX kapatma süreç grubuna sinyal yollar ve dirençli süreç için zorla kapatma zamanlayıcısı kurar.
- İptal edilmiş alt ajan kuyruğu kapasite tüketmez.
- Key-health yazımında kilit geçiciyse güncel kayıt korunur; kalıcı I/O hatası talebi bozmaz.
