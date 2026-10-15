# Mahalle-first ADM3 — gap analysis (keşif)

**Üretim zamanı (UTC):** 2026-10-15T17:14:34.575Z  
**Doğrulanan `origin/main`:** `d0d977f684b868adb37e40676747725d7a231453`  
**PR #111:** merge edildi (ulusal geometri remediation + rc.8 doğrulama).

## Özet

TerritoryKit bugün **mahalle-first** hedefi için güçlü bir governance + v1.7 smart-derived altyapısına sahip; ancak **smart-derived-v2** kodu yok ve ulusal kalite metrikleri (631 düşük güven / 577 realism uyarısı) Sprint 2 İstanbul kabul koşullarını karşılamıyor. rc.7 ve rc.8 artefaktları salt okunur baseline olarak korunmalı; yeni denemeler `.territory/mahalle-first-pilot/` altında yapılmalı.

## Sprint durumu (dört sprint + 3.5/3.6)

| Sprint | Odak | Durum |
| ------ | ---- | ----- |
| 1 | Kaynak / governance | **done** (#107) |
| 2 | İstanbul ADM3 kalite | **done** (#108) — 6 ilçe |
| 3 | Ulusal RC + delivery | **done** (#109) |
| 3.5 | 973 ilçe envanter QA | **done** (#110) |
| 3.6 | Geometri remediation rc.8 | **done** (#111) |
| 4 | Rush&Claim | **planlı** — yasal/hosted kapıları açık değil |

## Governance delta (Sprint 1 yeniden değerlendirme)

Registry özeti: **81** il, **4** il productionEligible, **62** official-restricted.

### Odak iller (makine okunur: `gap-analysis.json` → `governanceDelta.focusProvinces`)

| İl | Registry status | Catalog ingestion | Not |
| --- | --- | --- | --- |
| Bursa (16) | official-ready | adm3-catalog SHA pinned | Lisans: Bursa Açık Veri — redistribution allowed (catalog) |
| Gaziantep (27) | official-ready | KML pinned | CC BY 4.0 (catalog) |
| İstanbul (34) | partial-official | yok | İBB servis **license-blocked**; Kadıköy SHP **BLOCKED_BY_SOURCE** |
| Sakarya (54) | official-license-review | GeoJSON URL | CRS/reprojection engeli; **candidate**, productionEligible false |
| Sivas (58) | official-license-review | SHP ZIP | İndirme timeout; alan şeması bekliyor |

**Veri katmanları:** indirilen doğrulanmış bytes ≠ onaylı redistribution ≠ gameplay estimated zone. Eksik kurum izinleri `human-approvals-required.json` içinde **PENDING_REVIEW** / **NOT_AUTHORIZED** olarak kalır.

## Modül eşlemesi ve boşluklar

- **Source registry (81 il)** → `datasets/sources/TR/adm3/source-registry.json` — *gap:* 4/81 productionEligible; 62 official-restricted; İstanbul license-blocked
- **Official importer / adapters** → `packages/generators/src/turkey-adm3-ingestion.ts, turkey-adm3-adapters.ts, adm3-catalog.json` — *gap:* Sakarya CRS/reprojection; Kadıköy bundle structurally invalid; Sivas download timeout
- **OSM pipeline + barriers** → `packages/generators/src/turkey-osm-barriers.ts, turkey-adm3-osm.ts` — *gap:* Eyüpsultan %24 network coverage; sparse barrier graphs in rural pilots
- **smart-derived v1.7** → `packages/generators/src/turkey-smart-fallback.ts` — *gap:* smart-derived-v2 yok; 631 low-confidence / 577 realism-warning districts (rc.8)
- **Mahalle seed resolver** → `turkey-osm-barriers locality-seeds.json + normalizeLocalitySeeds in smart-fallback` — *gap:* Seed coverage düşük; nameSource=generated-index yaygın; resmi mahalle uydurma yok (doğru)
- **Barrier graph + organic routing** → `turkey-network-faces.ts, turkey-network-bounded.ts, turkey-organic-routing.ts` — *gap:* Eyüpsultan ORGANIC_ROUTE_NO_PATH; parçalı graph bileşenleri
- **Coastline / water QA** → `turkey-istanbul-geometry-diagnostics.ts, inspectTurkeyGeneratedCoastlineSpill` — *gap:* Sprint-2 pilotlarda coastlineEvidence çoğunlukla NOT_ASSESSED
- **Disconnected geometry QA** → `turkey-generated-zone-pathology.ts, component-chunk in smart-fallback` — *gap:* crossWaterComponentSeparation çoğu pilotte NOT_ASSESSED
- **Hybrid priority + clipping** → `packages/generators/src/turkey-v2-hybrid.ts` — *gap:* PR #111 sibling overlap remediation; kalite skorları değişmedi
- **National assembly + source-lock** → `turkey-v2-national.ts, packages/cli tr v2 national` — *gap:* rc.8 publishReady=false (buildMode partial); rc.7 bytes korunmalı
- **QA / MVT / migration** → `packages/dataset quality, render-artifacts, @territory-kit/migration` — *gap:* rc.8 geometry hash delta 34 zone; migration-plan.json rc.7→rc.8 için authoritative değil

## smart-derived-v2 gereksinim boşlukları

- **v2-algorithm-version** (missing): Kod yalnızca smart-derived-v1.7 kabul ediyor (SMART_FALLBACK_UNSUPPORTED_ALGORITHM aksi halde).
- **seed-anchored-partition** (partial): v1.7 seed ataması var; mahalle seed yoğunluğu ile bölüm sayısı hizası zayıf (özellikle kırsal).
- **coastline-assessment** (partial): Su poligonu yoksa fail-closed NOT_ASSESSED; v2 kıyı politikasını genişletmeli.
- **barrier-graph-fragmentation** (blocked-pilot): Eyüpsultan 368 graph bileşeni; v2 pilot önceliği.
- **official-vs-gameplay-separation** (done): administrative:false, boundarySourceClass smart-derived, dataset validation enforced.

## Tamamlanan / engelli

**Tamamlanan:** PR #111 merged on origin/main; Source registry 81 il + adm3-catalog 4 ingestion-ready provinces; smart-derived-v1.7 national rc.7/rc.8 topology remediation; Sprint 2 Istanbul diagnostic reports and Kadıköy acquisition failure classification

**Engelli:** ADM3 official expansion without per-province legal acceptance; Kadıköy mahalle SHP bundle (identical companion bytes); İstanbul İBB ArcGIS — license-blocked, research-only; National publish-ready / production promotion; 973-district full rebuild for v2 until Istanbul pilot acceptance

## Sonraki adımlar (İstanbul pilot)

1. Run scripts/tr-mahalle-first-istanbul-v2-pilot.mjs against rc.7 baseline bytes
2. Implement smart-derived-v2.0-pilot behind explicit opt-in (no national default)
3. Re-assess coastline/barrier metrics on 8 Istanbul districts including Başakşehir/Esenyurt

---

Makine okunur rapor: [`gap-analysis.json`](./gap-analysis.json)
