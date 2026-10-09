# Path B metadata-only downstream impact (read-only)

## ADM3 national clip

- ADM3 üretimi ebeveyn ADM2 poligonlarına göre kırpılır (`buildTurkeyV2NationalDataset` / hybrid clip).
- **Metadata-only Path B** (katalog/registry/source-lock metinleri) canonical ebeveyn **geometri baytlarını** değiştirmezse ADM3 clip girdisi değişmez; clip replay beklenen etki: **yok**.
- Ebeveyn geometri baytları değişirse ADM3 effective geometry, coverage ve MVT hash'leri etkilenir — bu sprint canonical baytları değiştirmedi.

## Manifest, cache ve tüketici

- `datasets/generated/countries/TR/manifest.json` checksum'ları geometry tier hash'lerine bağlıdır.
- Metadata-only değişiklik manifest `sourceProvider` / attribution alanlarını güncelleyebilir; geometry checksum'ları aynı kalırsa tüketici geometry cache'i invalidate olmayabilir — **doğrulanmadı, production öncesi rc.7 replay zorunlu**.

## Rush&Claim

- Bu sprint Rush&Claim veya hosted delivery'ye dokunmaz.

## Önkoşullar (Path B metadata GO)

1. `legalReviewStatus: PENDING_REVIEW` çözümü (CC BY-SA 2.0 / ODbL 1.0 / adapter CC BY 4.0 çelişkisi).
2. ADR-006 / DEC-008 onayı.
3. Tam builder replay kanıtı + ADM3 clip regression planı.
