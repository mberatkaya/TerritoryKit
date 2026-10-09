# Türkiye ADM0–ADM2 kaynak yönetişimi — konsolide durum

**Üretim:** Sprint 1 kapanış (`fix/tr-source-governance-closeout`)  
**Doğrulanan `origin/main` tabanı:** `dd3ab8eea31e0f1bce1cbb664105f53d150d7ca9`  
**Makine okunur:** [source-governance-status.json](source-governance-status.json)

## Birleştirilmiş araştırma PR'ları (yeniden açılmaz)

| PR                                                          | Durum    | Özet                                                                                                                                       |
| ----------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| [#104](https://github.com/mberatkaya/TerritoryKit/pull/104) | Birleşti | Ebeveyn provenance denetimi; katalog/kilit ile canonical polygon uyumsuzluğu doğrulandı; publish-ready fail-closed                         |
| [#105](https://github.com/mberatkaya/TerritoryKit/pull/105) | Birleşti | geoBoundaries gbOpen bayt hattı, kimlik karşılaştırması, Path B kısmi kanıt                                                                |
| [#106](https://github.com/mberatkaya/TerritoryKit/pull/106) | Birleşti | Tam `buildTerritoryCountryDataset` replay; 44 serileştirilmiş hash farkı; coğrafi IoU toleransı içinde eşdeğerlik; deterministik çift koşu |

Detaylı kanıt dizinleri: `reports/tr-adm3/provenance/`, `reports/tr-adm3/provenance/geoboundaries/replay/`.

## Doğrulanmış bulgular (değiştirilmedi)

1. **Canonical ebeveyn** (`datasets/generated/countries/TR/dataset.json`, gitignore): ADM0–ADM2 kayıtları `geoboundaries` provenance taşır.
2. **Ulusal katalog** (`datasets/sources/TR/national.json`): varsayılan sağlayıcı `hdx-cod-ab` (OCHA COD-AB); kilitlenmiş ZIP üyeleri yerelde doğrulanabilir.
3. **geoBoundaries gbOpen** sabitlenmiş simplified baytlar: `sources.lock.json` ile SHA-256 uyumu (#105).
4. **Kaynak-native kimlikler:** ADM0=1, ADM1=81, ADM2=973 eşleşmesi (#105–#106).
5. **Tam builder replay:** sınıflandırma `GEOGRAPHICALLY_EQUIVALENT_WITH_DIFFERENCES`; **44** kimlik-eşleşen çiftte serileştirilmiş geometri hash uyuşmazlığı; replay deterministik (#106).
6. **Kök neden:** tarihsel repair/GEOS motoru iddiası kanıtlanmış değil; `replay-conclusion.md` çoğu uyuşmazlığı `unresolved` sınıfında tutar.
7. **Path B:** teknik öneri **`PARTIAL`**; **`legalReviewStatus: PENDING_REVIEW`**; **üretim onayı yok**; metadata migrasyonu **yetkisiz**.

Bu sprint canonical polygon baytlarını, stabil territory ID'leri, ADM3 poligonlarını veya `national.json` içeriğini değiştirmedi.

## Ulusal dataset adayı (bağlam)

| Alan   | Değer                                                            |
| ------ | ---------------------------------------------------------------- |
| Paket  | `territory-kit-tr-v2-playable@2.1.0-rc.7`                        |
| Kapsam | `LOCAL_RELEASE_CANDIDATE_NOT_PRODUCTION`                         |
| Kanıt  | `reports/tr-adm3/audit/baseline-claims.json`, `current-state.md` |

**Önemli ayrım:** Kayıtlı **renderable** alan kapsaması (~99.999979%) oyun geometrisi tamlığı ölçümüdür; resmî idari doğruluk iddiası değildir. **Resmî** efektif alan payı (~4.997459%) ayrı bir metriktir.

## Aktif dört sprint programı

1. **Sprint 1:** Kaynak ve yönetişim kapanışı (bu PR)
2. **Sprint 2:** İstanbul ADM3 geometri kalitesi
3. **Sprint 3:** Ulusal RC ve teslimat doğrulama
4. **Sprint 4:** Rush&Claim entegrasyonu

## PR #103

[Version Packages #103](https://github.com/mberatkaya/TerritoryKit/pull/103) **OPEN** — bu sprintte birleştirilmedi ve değiştirilmedi.
