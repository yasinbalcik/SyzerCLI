# Görev: ledger.py — basit hesap defteri

Çalışma klasöründe tek bir Python 3.10 modülü `ledger.py` yaz (yalnızca standart kütüphane). Ayrıca `test_ledger.py` içinde **unittest** ile kendi testlerini yaz ve `python -m unittest -v` ile çalıştırıp geçtiğini doğrula.

## Satır biçimi
`TARİH,HESAP,TÜR,TUTAR[,HEDEF]`
- TARİH: `YYYY-MM-DD`, geçerli bir takvim tarihi olmalı (ör. 2026-02-30 geçersiz).
- HESAP / HEDEF: boş olmayan, baş/son boşlukları kırpılmış metin.
- TÜR: `deposit`, `withdraw` veya `transfer`.
- TUTAR: pozitif sayı (> 0), en çok 2 ondalık basamak. `0`, negatif, sayı olmayan → geçersiz.
- `transfer` için 5. alan HEDEF zorunlu ve HESAP'tan farklı olmalı; diğer türlerde 5. alan olmamalı.

## API
- `parse_line(line: str) -> dict` → `{"date": "YYYY-MM-DD", "account": str, "type": str, "amount": Decimal, "target": str | None}`. Geçersizse `ValueError`.
- `class InsufficientFunds(Exception)`
- `class Ledger`:
  - `apply(tx: dict) -> None` — işlemi uygular. withdraw/transfer bakiyeyi eksiye düşürecekse `InsufficientFunds` fırlatır ve **hiçbir durumu değiştirmez**.
  - `balance(account) -> Decimal` — bilinmeyen hesap için `Decimal("0")`.
  - `history(account) -> list[dict]` — o hesabı etkileyen (kaynak ya da hedef olduğu) başarılı işlemler, uygulanma sırasıyla.
  - `accounts() -> list[str]` — en az bir başarılı işlemde geçen hesaplar, alfabetik.
- `load(path) -> tuple[Ledger, list[tuple[int, str]]]` — dosyayı satır satır uygular. Boş satırlar ve `#` ile başlayan satırlar atlanır. Geçersiz satırlar ya da yetersiz bakiye → `(satır_no, mesaj)` hata listesine eklenir (satır numaraları 1'den başlar, atlanan satırlar da sayılır) ve işleme devam edilir.

## CLI
`python ledger.py DOSYA`
- stdout: `accounts()` sırasıyla her hesap için `hesap: bakiye` (bakiye her zaman 2 ondalık, ör. `alice: 100.50`).
- stderr: her hata için `line N: mesaj`.
- Çıkış kodu: hata varsa 1, yoksa 0. Dosya yoksa stderr'e mesaj ve çıkış kodu 2.
