# Sprint 2 — İstanbul ADM3 geometri kalitesi (uygulama devri)

**Sprint 1 kapsamı dışı:** Bu belge yalnızca Sprint 2 master prompt girdilerini tanımlar; kod değişikliği Sprint 1 branch'inde yapılmaz.

## Mevcut modüller (yeniden yazılmaz)

| Modül                                                  | Yetenek                                                     |
| ------------------------------------------------------ | ----------------------------------------------------------- |
| `turkey-smart-fallback.ts`                             | v1.7 sıralama, network-first, confidence / hard-reject      |
| `turkey-osm-barriers.ts`                               | Kilitli PBF, bariyer katmanları, multipolygon normalizasyon |
| `turkey-network-faces.ts`, `turkey-network-bounded.ts` | Ağ nodlama, bounded polygonization, limitler                |
| `turkey-adm3-ingestion.ts`                             | Belediye katalogları, CRS 4326/3857, adapter'lar            |
| `turkey-adm3-full-coverage.ts`                         | Ulusal boşluk doldurma pipeline                             |
| `packages/dataset/src/quality.ts`                      | Topoloji ve metadata QA                                     |
| `scripts/sprint-6-istanbul-qa.mjs`                     | İlçe replay ve determinizm                                  |

## Pilot öncelikleri

### Fatih

- **Mevcut:** 30 zone, high confidence, 71 seed, topoloji PASS; uzun unsupported chain 0 m (`istanbul-geometry-defects.md`).
- **Eksik:** Spike/sliver ve bariyer hizası için **üretilmiş-only** şekil patolojisi export'u (audit roadmap madde 4).
- **Fixture:** `reports/tr-adm3/audit/istanbul-replay.json` Fatih bloğu; canonical ADM2 `tr:adm2:…` (replay dosyasında).
- **Kabul:** Yeni diagnostik eşikleri yalnızca `sourceKind: generated` için; resmî poligonlara kozmetik repair uygulanmaz.

### Kadıköy

- **Mevcut:** 28 tahmini zone vs belediye 21 mahalle; resmî polygon yok (`source-readiness.md`, `kadikoy-acquisition.json`).
- **Eksik:** Tam SHP+SHX+DBF+PRJ bundle; 21 kayıt tutarlılığı; ingestion başarısı.
- **Kabul:** Karşılaştırma artifact'i önce; production promote yok.

### Üsküdar

- **Mevcut:** 40 zone, high confidence, topoloji PASS.
- **Eksik:** Kıyı/su maskesi politikası ve görsel kıyı doğrulama (audit H kategorisi açık).
- **Kabul:** Su/spill politika fixture'ı + mevcut parent-containment gate'leri.

### Adalar (Prince Islands)

- **Mevcut:** 14 zone, low confidence, multipolygon replay canonical ile birebir.
- **Eksik:** Ada bütünlüği ve cross-island görsel doğrulama; su/kıyı politikası.
- **Kabul:** Component-aware island fixture'ları; cross-island defect yoksa kayıt altına alınır.

### Eyüpsultan / Çatalca

- **Eyüpsultan:** 3.611 km unsupported seam, NO_ROUTE, low confidence — **reprodüksiyonlu** (`istanbul-replay.json`).
- **Çatalca:** low confidence, ~7.8 km unsupported chain, 248 seed — kırsal ağ kısıtı.
- **Kabul:** Eyüpsultan için bağlı grafik diagnostik + güvenli düzeltme yoksa low kalır; Çatalca için neighbourhood semantiği ve realism eşikleri sınıflandırılır.

## Baseline karşılaştırmalar

| Referans                         | Konum                                                            |
| -------------------------------- | ---------------------------------------------------------------- |
| rc.7 ulusal candidate metrikleri | `reports/tr-adm3/audit/baseline-claims.json`, `current-state.md` |
| 10 ilçe QA                       | `istanbul-district-diagnostics.json`                             |
| 3 ilçe replay                    | `istanbul-replay.json`, `istanbul-determinism.json`              |
| Ağ diagnostik                    | `istanbul-recorded-network-diagnostics.json`                     |

## Sprint 2 çıkış testleri (önerilen)

```sh
pnpm data:tr:adm3:audit:test
ISTANBUL_QA_DISTRICT='Fatih,Kadıköy,Üsküdar,Prince Islands,Eyüpsultan,Çatalca' \
  ISTANBUL_QA_REPORT=reports/tr-adm3/sprint-2/istanbul-pilot-replay.json \
  node --max-old-space-size=8192 scripts/sprint-6-istanbul-qa.mjs
```

Kadıköy resmî bundle edinildiğinde:

```sh
pnpm turkey:adm3:ingestion:smoke
```

## Ayrım (zorunlu)

- **Resmî lisanslı poligonlar** → `official` source tier, ayrı geometry hash.
- **Tahmini oyun geometrisi** → `generated` / Smart; yasal mahalle sınırı değildir.
- Renderable kapsama ≠ resmî idari doğruluk.
