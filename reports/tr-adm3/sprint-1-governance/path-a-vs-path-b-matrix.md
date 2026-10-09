# Path A vs Path B — karar matrisi

**ADR-006:** Accepted — **bu sprintte değiştirilmedi.**  
**DEC-008:** Proposed — **otomatik kabul edilmedi.**  
**Makine okunur:** [path-a-vs-path-b-matrix.json](path-a-vs-path-b-matrix.json)

## PATH A — Ebeveyn poligonları HDX COD-AB'ye taşı

| Boyut         | Değerlendirme                                                                      |
| ------------- | ---------------------------------------------------------------------------------- |
| Teknik        | Kilitli HDX ZIP üyelerinden ADM0–ADM2 yeniden import; `dataset.json` bayt değişimi |
| Geometri / ID | Serileştirilmiş hash ve olası ID alanı farkları; tam ADM3 clip regresyonu          |
| Lisans        | HDX CC BY-IGO katalogda belgelenmiş; türev oyun dataset'i ayrı inceleme            |
| ADM3 clipping | **Yüksek** — tüm mahalle/zone parent clip yeniden oynatılmalı                      |
| Kayıt / kilit | `national.json` ile polygon hizalanır                                              |
| Tüketici      | Versiyonlu migrasyon; MVT yeniden üretim                                           |
| Onaylar       | ADR güncellemesi, hukuk, ulusal rebuild yetkisi                                    |
| Geri alma     | geoBoundaries canonical SHA-256 ve önceki dataset sürümü saklanmalı                |

## PATH B — Katalog/metadata'yı mevcut geoBoundaries canonical ebeveyn ile hizala

| Boyut         | Değerlendirme                                                                     |
| ------------- | --------------------------------------------------------------------------------- |
| Teknik        | Yalnızca metadata (`national.json`, source-lock dizeleri); canonical bayt korunur |
| Geometri / ID | Amaçlanan bayt değişikliği yok; **44** replay hash farkı belgelenmiş kalır (#106) |
| Lisans        | CC BY-SA / ODbL / CC BY 4.0 çelişkisi **çözülmedi**; **üretim onayı yok**         |
| ADM3 clipping | Düşük (bayt değişmezse); yanlışlıkla geometry refresh engellenmeli                |
| Kayıt / kilit | Sağlayıcı `hdx-cod-ab` → geoBoundaries pin                                        |
| Tüketici      | Attribution metni değişir; geometri sabit kalabilir                               |
| Onaylar       | DEC-008, ADR-006 değişikliği, hukuk, 44 farkın kabulü veya azaltma planı          |
| Geri alma     | HDX katalog checksum'ları ve eski `national.json`                                 |

## Öneri (mühendislik — nihai karar insan onayında)

**`DEFER_MIGRATION`:** Mevcut kanıt, katalog/polygon uyumsuzluğunu belgelemek ve hukuk incelemesini tamamlamak için yeterli. Path B teknik olarak **`PARTIAL`**; Path A veya Path B uygulanmadan önce `human-approvals-required.json` kalemleri kapanmalıdır.

**Path B üretim onaylı değildir** ve bu PR metadata migrasyonu içermez.
