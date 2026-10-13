# Sprint 3 — Ulusal RC ve teslimat doğrulama (handoff)

**Önkoşul:** Sprint 2 PR #108 merge — diagnostik/kanıt düzeltmeleri; **rc.7 promote veya ADM3 poligon değişikliği yapılmadı**.

## Sprint 2 çıkış özeti (kanıt)

| Konu                 | Durum                                                                           |
| -------------------- | ------------------------------------------------------------------------------- |
| Kıyı/su spill        | Gerçek water polygon kesişimi; coastline → su yok; `NOT_ASSESSED` fail-closed   |
| Ada multipolygon     | Centroid köprü heuristiği kaldırıldı; bbox dar boyun `SUSPECTED`                |
| Kadıköy bundle       | `BLOCKED_BY_SOURCE`; acquisition duplicate bytes `HISTORICAL_AUDIT_ONLY`        |
| Pilot rapor          | Gerçek zone yükleme (varsa), SHA-256 dosya baytları, 3 ilçe determinizm kapsamı |
| Geometri / stable ID | **Değişiklik yok**                                                              |

## Sprint 3 öncelikli işler

1. **rc.7 consumer replay** — hosted delivery ve cache state doğrulama (`reports/tr-adm3/audit/baseline-claims.json`).
2. **81 il ADM3 registry tutarlılığı** — `adm3-readiness-report.json` ile canlı artifact karşılaştırması.
3. **Path A/B** — yalnızca insan onayı + DEC-008 / ADR-006 sonrası (`human-approvals-required.json`).
4. **İstanbul canlı replay** — `.territory/sprint-6` bariyer bundle ile 6 pilot için `REAL_REPLAY_VERIFIED` coastline/island.
5. **Kadıköy** — bağımsız SHP+SHX+DBF+PRJ edinimi; ingestion smoke (`pnpm turkey:adm3:ingestion:smoke`).

## Doğrulama komutları

```sh
pnpm data:tr:adm3:audit:test
CI=true pnpm format:check
pnpm docs:links
pnpm verify
```

## Bilinçli dışlama

- PR #103 merge / npm publish
- Rush&Claim entegrasyonu (Sprint 4)
- Yetkisiz national.json veya canonical polygon migration
