# D1 — Orca Dayanıklılığı Tasarımı

## Gerçek kaynak sahipliği

Bu çalışma dalında `src/orca-patch.js` yoktur; `src/` altında yalnızca SyzerCLI
tarafındaki köprü, hook ve worker kodu bulunur. `src/orca-bridge.js`, eklentiyi
varsayılan olarak GitHub'daki `yasinbalcik/SyzerCLI-Orca` yayımından
`~/.syzercli/orca-plugin/app` altına indirir ve `bin/syzer-orca.js`yi çalıştırır.
Dolayısıyla `app.asar` yama motoru, `patch.log` ve `quit.log`un üretildiği kod bu
repo değil, kurulu eklenti paketidir. D0 kaydındaki iki ifade çelişmiyor: `syzer
orca install` bu repodaki köprüyü kullanarak ayrı `SyzerCLI-Orca` paketini kurar.

Bu kartta bu repodaki gözlemleme/sözleşme katmanı güçlendirilecektir. Ayrı eklenti
kaynak kodu bu çalışma ağacında bulunmadığından `src/orca-patch.js`ne değişiklik
yapılmayacak veya sahte bir dosya oluşturulmayacaktır. Eklenti log yazımı için
paylaşılan `src/logs.js` kullanılabilir olacak; eklentinin buna geçirilmesi ayrı
repo kartıdır.

## Kararlar ve gerekçeler

1. Worker başarısı yalnızca `result.txt` içeriğiyle değil, Orca terminalinin
   canlılığıyla da belirlenir. `terminal create --json` sonucundaki handle için
   `orca terminal status --terminal <handle> --json` yoklaması yapılır. Çıkış/son
   durum sonucu dosyası oluşmadan görülürse 15 dakika beklenmez ve
   `ERR_TOOL_FAILED:` ile başlatılan, kısa ve eyleme dönük bir hata döner.
   Durum API'si desteklenmiyor veya okunamıyorsa geriye uyumlu olarak eski dosya
   bekleme yolu sürer; böylece eski Orca CLI'ları yanlış negatif üretmez.
2. İşçi sonucu atomik değildir; dosya görünür olduktan sonra kısa yerleşme
   gecikmesi korunur. Hata sonucu her zaman mevcut `P.error('TOOL_FAILED', ...)`
   biçiminde kalır; headless JSON ve mevcut `ERR_<CODE>` sözleşmesi değişmez.
3. Yeni `src/logs.js`, UTF-8 metin günlüklerini yazmadan önce döndürür: varsayılan
   üst sınır 200 KiB, tek yedek `.1`, yazma hatası çağıranı düşürmez. Bu, D0'daki
   `patch.log` sınırıyla uyumludur ve `quit.log`/hook hata günlüğü için ortak,
   test edilebilir saf dosya yardımcıları sağlar. Günlüğe token, prompt veya hook
   gövdesi yazılmaz.
4. Hook gönderimi UI yolundan ayrık kalır: her olay en çok 800 ms bekler; zaman
   aşımı, HTTP 4xx/5xx, soket ve ayrıştırma hataları dönen `hook-errors.log`a
   sınırlı/rotasyonlu, hassas olmayan özet olarak yazılır. Gönderim hiçbir zaman
   çağıranı reddetmez veya terminal çizimini bozmaz.
5. `syzer doctor` ile `syzer orca status` eklentinin verdiği grup sonucunu aynen
   yorumlar. Sebep `anchor matched 0x`/anchor bulunamadı ise ayrı, açık bir uyarı
   verilir ve ilgili grubun özelliğinin devre dışı kaldığı belirtilir. `status`
   içindeki `patched: false` veya `upToDate: false` de Orca güncellemesinden sonra
   yamanın düştüğü/eski kaldığı şeklinde açıkça raporlanır; çözüm Orca kapalıyken
   `syzer orca patch`tir. Eklentinin mevcut JSON şekilleri korunur.

## Test planı

- `test/orca-workers.test.js`: terminal durumunun erken çıkışını, desteklenmeyen
  durum sorgusunda uyumlu beklemeyi ve `ERR_TOOL_FAILED` sonucunu test eder.
- `test/orca-logs.test.js`: sınır, `.1` yedeği, yazma hatasının yutulması ve
  hassas veri yazmama çağrı sözleşmesini test eder.
- `test/doctor-orca.test.js`: anchor-0x uyarısı, kaybolmuş/eski yama ve normal
  grup çıktılarını test eder.
- Mevcut `plan-hook.test.js`e timeout/HTTP hata günlüğü testleri eklenir; hook
  çağrısının çözülmeye devam ettiği doğrulanır.

## Kapsam dışı

- `app.asar` anchor/yama motorunun yeniden yazımı, yeni hook olayları ve ayrı
  `SyzerCLI-Orca` deposuna değişiklik bu kartın dışındadır.
- Terminal görsel çizimi değiştirilmeyecek; canlilik sınıflandırması saf ve
  enjekte edilebilir yardımcılarla birim test edilecektir.
