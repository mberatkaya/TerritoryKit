# Path B (geoBoundaries metadata realignment) feasibility

**İnceleme commit:** `aac6e86c8e29d02da9acb6ec8a5e24216815eb10`  
**Üretim zamanı (UTC):** 2026-10-08T21:42:56.729Z  
**Sınıflandırma:** `PATH_B_PARTIALLY_VERIFIED`

## Özet

Source-native identities align and bytes are pinned, but serialized geometry hashes do not fully match after repair (or geographic equivalence was not assessed).

## Kanıt durumu

| Alan | Durum |
| --- | --- |
| geoBoundaries bayt doğrulaması | EVET |
| Ebeveyn envanter | COMPLETE |
| Lisans inceleme | documented-cc-by-4.0-gbopen |
| Resmî devlet verisi iddiası | Hayır — geoBoundaries açık veri sınırları geçerli |

## Eksik kanıt

- (yok)

## ADR-006 notu

Bu rapor ADR-006 (HDX/OCHA COD-AB varsayılanı) kararını **değiştirmez**. Path B yalnızca ayrı yetkilendirilmiş bir migrasyon PR'si için ön koşul kanıtı sağlar.

## Yeniden üretim

```sh
pnpm data:tr:geoboundaries:parent:audit
```

Yerel önbellek gerekir: `.territory/cache/sources/geoboundaries` ve gitignore altındaki `datasets/generated/countries/TR/`.
