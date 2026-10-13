# Hosted teslimat hazırlığı (teknik değerlendirme)

**Sınıflandırma:** LOCAL_CONSUMER_VERIFIED — HOSTED_DELIVERY_VERIFIED değil

## Gözlemlenen yerel sözleşme

- Manifest: `delivery-manifest-hardened.json` (contentHash: `4c1d42a082a63f5170a63ce150a1e3c5abbe4486ec4dbf1ed3c43789088a31cb`)
- MVT şablonu: `render/tiles/{z}/{x}/{y}.mvt`, zoom 10–12
- MapLibre source-layer (protobuf): `territory_adm3`
- Render artifact layer id: `territory-adm3` (manifest `layers[].id`, source-layer değildir)
- Delivery manifest sourceLayer: `UNDECLARED_IN_RC7`
- MVT source-layer gate (`sourceLayerReady`): `PASS`
- Tam MVT teslimat gate (`fullMvtDeliveryReady`): `FAIL` — `deliveryReadinessGate.pass` = `false`
- İlçe örnekleme (parentAdm2Id): `FAIL` (rc.7 tile özelliklerinde parentAdm2Id yok — #94; başarı uydurulmaz)

## Rush&Claim — mevcut rc.7 ile güvenli kullanım

- **Güvenli:** MapLibre/Mapbox vector source; `source-layer: territory_adm3`; zoom 10–12; ulusal ADM3 poligon görselleştirme; `resolveTurkeyV2Boundaries` + district shard ile oyun mantığı (manifest adm2Shards).
- **Güvenli değil / eksik:** MVT tile içinden ilçe (`parentAdm2Id`) filtreleme veya tile-only district seçimi; tile feature(0) ile ilçe varsayımı; hosted production CDN doğrulaması olmadan yayın.

## Hosted doğrulama durumu

Bu sprintte yetkili bir production CDN/URL üzerinde salt okuma doğrulaması **yapılmadı** (erişilebilir host kanıtı yok).

## Beklenen tüketici gereksinimleri (dokümantasyon)

- HTTPS, immutable release kimliği, manifest önce / shard sonra atomik yayın
- CORS ve Cache-Control: uzun ömürlü tile, manifest için sürüm pin
- Karışık sürüm koruması: manifest contentHash ve shard SHA-256
- Eksik dosya: fail-closed (runtime checksum)

## Üretim engelleri

- `fullMvtDeliveryReady` = false (ilçe MVT metadata kanıtı yok)
- `human-approvals-required.json`: NATIONAL_DATASET_PROMOTION = NOT_AUTHORIZED
- PR #103 merge/publish yetkisi yok
