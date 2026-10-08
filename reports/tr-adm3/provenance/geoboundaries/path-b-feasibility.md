# Path B (geoBoundaries metadata realignment) feasibility

**İnceleme commit:** `4adc529dc6321a81daee782c7afcc1a9170071fe`
**Üretim zamanı (UTC):** 2026-10-08T21:50:41.394Z
**Sınıflandırma:** `PATH_B_PARTIALLY_VERIFIED`

## Özet

Source-native identities align and bytes are pinned, but serialized geometry hashes do not fully match after repair (or geographic equivalence was not assessed).

## Kanıt durumu

| Alan                                 | Durum                                             |
| ------------------------------------ | ------------------------------------------------- |
| geoBoundaries bayt doğrulaması       | EVET                                              |
| Ebeveyn envanter                     | COMPLETE                                          |
| Hukuk inceleme                       | PENDING_REVIEW                                    |
| Migrasyon yetkisi                    | NOT_AUTHORIZED                                    |
| Tam pipeline yeniden üretilebilirlik | INCOMPLETE                                        |
| Resmî devlet verisi iddiası          | Hayır — geoBoundaries açık veri sınırları geçerli |

## Serileştirilmiş geometri özeti

ADM0: onarım sonrası 1/1 serileştirilmiş hash eşleşmesi; 0 uyumsuzluk; ADM1: onarım sonrası 57/81 serileştirilmiş hash eşleşmesi; 24 uyumsuzluk; ADM2: onarım sonrası 953/973 serileştirilmiş hash eşleşmesi; 20 uyumsuzluk

## Eksik artifact dosyaları

- (yok — bu kategori için kayıt yok)

## Çözülmemiş geometri kanıtı

- ADM0: geographic/topological equivalence not assessed (serialized hash only).
- ADM1: 24 serialized geometry hash mismatches after geometry-repair (57/81 matches); geographic equivalence NOT_ASSESSED.
- ADM1: geographic/topological equivalence not assessed (serialized hash only).
- ADM2: 20 serialized geometry hash mismatches after geometry-repair (953/973 matches); geographic equivalence NOT_ASSESSED.
- ADM2: geographic/topological equivalence not assessed (serialized hash only).
- Full country-builder pipeline replay (buildTerritoryCountryDataset) not executed in this audit — geometry-repair-only replay is insufficient for PATH_B_VERIFIED_CANDIDATE.

## Çözülmemiş kaynak envanter kanıtı

- ADM2: lock metadata feature count 999 vs raw GeoJSON 973 — source-lock sourceFeatureCount (999) differs from raw GeoJSON features (973); lock metadata likely from geoBoundaries API admUnitCount and may not match simplified artifact bytes.

## Çözülmemiş lisans / attribution kanıtı

- Per-level lock license strings (OSM/CC-BY-SA/ODbL) are not automatically equivalent to geoBoundaries gbOpen CC BY 4.0 adapter default — legal compatibility requires human review.
- geoBoundaries data must not be represented as authoritative Turkish government boundaries.
- ADM levels declare different upstream license strings: Creative Commons Attribution-ShareAlike 2.0 | Open Data Commons Open Database License 1.0.
- ADM0 metadata URL (inspect upstream fields): https://www.geoboundaries.org/api/current/gbOpen/TUR/ADM0/
- ADM1 metadata URL (inspect upstream fields): https://www.geoboundaries.org/api/current/gbOpen/TUR/ADM1/
- ADM2 metadata URL (inspect upstream fields): https://www.geoboundaries.org/api/current/gbOpen/TUR/ADM2/

## ADR-006 notu

Bu rapor ADR-006 (HDX/OCHA COD-AB varsayılanı) kararını **değiştirmez**. Path B yalnızca ayrı yetkilendirilmiş bir migrasyon PR'si için ön koşul kanıtı sağlar.

## Yeniden üretim

```sh
pnpm data:tr:geoboundaries:parent:audit
```

Yerel önbellek gerekir: `.territory/cache/sources/geoboundaries` ve gitignore altındaki `datasets/generated/countries/TR/`.
