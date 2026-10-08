# Path B migrasyon etki planı (yalnızca plan)

**İnceleme commit:** `4adc529dc6321a81daee782c7afcc1a9170071fe`  
**Durum:** Migrasyon uygulanmadı — etki analizi taslağı

## ADM0–ADM2 kimlikler

- Mevcut canonical ebeveyn `tr:adm1:tr-XX` / ilçe kimlikleri **korunur** (Path B geometri baytlarını değiştirmez).
- `properties.territory.source.sourceId` alanları geoBoundaries `shapeID` ile hizalıdır.
- `datasets/sources/TR/national.json` ve rc.7 `source-lock` HDX üye SHA-256 değerleri Path B'de **catalog realignment** gerektirir.

## ADM3 clipping

- ADM3 üretimi ebeveyn ADM2 poligonlarına bağlıdır; metadata-only Path B, clipping girdisini değiştirmez.
- Yine de `source-lock` ve attribution metinleri tüketici raporlarını etkiler — rc.7 replay zorunlu.

## Zone ID referansları

- Render/MVT ve `identity-map.json` stable ID'leri değişmez (geometri migrasyonu yok).

## Source-lock / manifest

- `national.json` → geoBoundaries gbOpen pin (`sources.lock.json` ile uyumlu).
- `datasets/registry/countries.json` provider alanı gözden geçirilmeli.
- ADR-006 supersede **onay gerektirir**.

## Geri alma

- HDX catalog lock'a dönüş Path A veya metadata geri alma commit'i ile mümkün; geometri değişmezse ID geri alma gerekmez.
