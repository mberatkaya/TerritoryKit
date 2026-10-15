# smart-derived-v2.0-pilot (İstanbul dar pilot)

**Durum:** tasarım / pilot — ulusal varsayılan değil.

## Amaç

`smart-derived-v1.7` topoloji ve barrier-guided bölümleme sağlar; mahalle-first programında eksik kalan:

- mahalle **seed coverage** ve isim ataması,
- **barrier graph** parçalanması (ör. Eyüpsultan),
- **coastline / su** QA (`NOT_ASSESSED` → ölçülebilir),
- ayrık bileşen / kıyı adası politikası.

v2, resmi idari mahalle **uydurmaz**; lisansı bilinmeyen belediye poligonlarını public artefaktlara koymaz.

## Pilot kapsamı

İlçeler: Fatih, Kadıköy, Üsküdar, Adalar, Eyüpsultan, Çatalca, **Başakşehir**, **Esenyurt**.

Baseline: `.territory/national-geometry-remediation/candidate-rc8-impl-rev1` (2.1.0-rc.8, salt okunur).

Pilot çıktıları: `.territory/mahalle-first-pilot/fatih-v2-impl-rev2/` (`pnpm data:tr:mahalle-first:fatih-v2-pilot`).

Algoritma: `buildTurkeySmartFallbackV2PilotWithAdjacency` (`impl-rev2`) — barrier yüzeyleri + çok kaynaklı seed watershed; bariyer geçiş maliyeti güçlü bariyerde artar (impl-rev1 `length/strength` hatası düzeltildi).

## Kabul kapısı (ulusal build öncesi)

Sprint 2 genişletilmiş pilot metriklerinde iyileşme; regresyon yok. Ayrıntı: `reports/tr-adm3/mahalle-first-program/gap-analysis.md`.
