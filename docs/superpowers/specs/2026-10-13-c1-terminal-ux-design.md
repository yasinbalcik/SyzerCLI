# C1 Terminal UX: Tamamlama, Kota Rehberi ve Oturum Arama

**Tarih:** 2026-10-13  
**Kart:** C1  
**Durum:** Uygulamaya hazır

## Amaç ve sınır

Bu kart, terminal çizimini değiştirmeden üç keşfedilebilirlik sorununu çözer:
argüman seviyesinde Tab tamamlama, kota/limit tükendiğinde eyleme dönük rehberlik
ve geçmiş oturumlarda metin/tarih araması. Headless JSON, `ERR_<CODE>` hata
sözleşmesi, `limits.js`, `atomic-json.js` ve izin güvenliği davranışları kapsam
dışında bırakılır ve korunur.

Küçük ekran mini-paneli, dock/odak yönetimi, Shift+Enter, fare ve diğer görsel
terminal değişiklikleri uygulanmayacaktır; kart NOTLAR'ına kaydedilecektir.

## 1. Saf tamamlama sözleşmesi

Yeni `src/complete.js`, `complete(line, cursor, context)` saf fonksiyonunu
sağlar. Sonuç her zaman şudur:

```js
{ candidates: string[], range: { start: number, end: number } }
```

`start` ve `end`, JavaScript dizge indeksleridir; `line.slice(start, end)`
tamamlanacak token'dır. Geçersiz imleç değerleri 0..`line.length` aralığına
sınırlandırılır. Hiç aday yoksa boş dizi ve aktif token aralığı döner.

Kararlar:

* Komut adı tamamlaması geriye uyumludur; komut adayları `context.commands`
  kaynağından alınır.
* `/model`, `/lang`, `/perm`, `/provider` ve `/effort` ilk argümanı,
  sırasıyla `context.models`, `context.languages`, `context.permissions`,
  `context.providers`, `context.efforts` içinden önek eşleşmesiyle tamamlar.
  Adaylar tekrarları atılmış, küçük/büyük harf duyarsız eşleşmiş ve kararlı
  alfabetik sıradadır. Bu güvenli seçim, sağlayıcı/model listesini yalnızca
  çağıranın verdiği geçerli anlık veriden üretir.
* Boş ilk argüman tüm adayları getirir. İkinci ve sonraki komut argümanları
  aday üretmez; yanlış bir komut söz dizimini sessizce değiştirmez.
* `@` ile başlayan, boşluksuz aktif token dosya tamamlamasıdır. `context.files`
  göreli dosya yollarını içerir; adaylar `@` öneki korunarak döner. Yalnızca
  önek eşleşmesi yapılır; dosya sistemi fonksiyonun içinde okunmaz.
* `src/input.js` yalnızca bağlayıcı olur: mevcut Tab akışında bu fonksiyona
  canlı komut/model/dil/izin/sağlayıcı/efor ve dosya listelerini geçirir,
  dönen aralığı tek adayda doğrudan değiştirir; çok adayda mevcut seçim UI'si
  kullanılır. Girdi yoksa önceki davranış sürer.

## 2. Kota rehberi sözleşmesi

Yeni `src/quota-guide.js`, `quotaGuide(error, locale, options)` saf fonksiyonunu
sağlar. HTTP durumu `402`, `403` veya `429` ise ya da `options.allKeysExhausted`
doğruysa `{ code, message, actions }` döner; diğer hatalarda `null` döner.
`actions` her zaman çalıştırılabilir komutlardan seçilir: `syzer key add`,
`syzer usage` ve başka bir sağlayıcıya geçiş önerisi.

`locale === 'tr'` Türkçe, diğer tüm değerler İngilizce metin üretir. `403`
yetki/key erişim sorunu olarak, `402` ödeme/kredi olarak, `429` hız/kota sınırı
olarak belirtilir; anahtar havuzu tümüyle tükendiyse bu önceliklidir. Mesajlar
anahtar değeri, sağlayıcı hata gövdesi veya gizli bilgi içermez.

REPL'de mevcut hata yazımı korunur ve bunun yanında yalnızca interaktif hata
akışında rehber basılır. Headless sonuç/JSON biçimi değiştirilmez.

## 3. `/resume` filtre sözleşmesi

`src/sessions.js`, `filterSessions(sessions, query, now)` saf yardımcısını
sağlar. Boş sorgu tüm oturumları korur. Metin sorgusu `id`, `title` ve
mesaj içeriklerinde küçük/büyük harf duyarsız aranır. Tarih sorgusu aşağıdaki
güvenli biçimleri destekler: `YYYY-MM-DD`, `today`, `yesterday` ve `N d`
(`N` pozitif tam sayı). Tarih eşleşmeleri yerel takvim gününde yapılır.

Filtre özgün sıralamayı korur, girdiyi değiştirmez ve hatalı/boş alanlara
dayanıklıdır. `/resume <sorgu>` bu yardımı mevcut oturum listesine uygular;
sonuç yoksa seçici açmak yerine açık bir "oturum bulunamadı" mesajı gösterir.
Sorgusuz `/resume` mevcut davranışını korur.

## 4. Doğrulama

TDD sırası: önce başarısız birim test, sonra en küçük uygulama. Yeni testler:

* `test/complete.test.js`: komut/argüman/`@dosya`, aralık, sıralama ve boş durumlar
* `test/quota-guide.test.js`: 402/403/429, tüm anahtarlar, TR/EN ve sıradan hata
* `test/resume-filter.test.js`: metin, tarih, sıralama, değişmezlik ve hatalı veri

`package.json` içindeki `npm test` listesine bu üç dosya eklenir; kart kapanışı
tam test takımının yeşil çıkmasını gerektirir.

## README doğruluğu

C0 envanterindeki davranışla çelişen README anlatımları kontrol edilecek;
yalnız gerçek davranışı doğru yapan Türkçe ve İngilizce belge değiştirilecektir.
Yeni Tab, kota ve `/resume` davranışları ancak uygulama sonrası belgelenir.
