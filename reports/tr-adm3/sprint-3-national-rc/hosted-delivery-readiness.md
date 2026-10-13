# Hosted teslimat hazırlığı (teknik değerlendirme)

**Sınıflandırma:** LOCAL_CONSUMER_VERIFIED — HOSTED_DELIVERY_VERIFIED değil

## Gözlemlenen yerel sözleşme

- Manifest: `delivery-manifest-hardened.json` (contentHash: `4c1d42a082a63f5170a63ce150a1e3c5abbe4486ec4dbf1ed3c43789088a31cb`)
- MVT şablonu: `render/tiles/{z}/{x}/{y}.mvt`, zoom 10–12
- Katman: `territory-adm3` (render/manifest.json ile uyumlu)

## Hosted doğrulama durumu

Bu sprintte yetkili bir production CDN/URL üzerinde salt okuma doğrulaması **yapılmadı** (erişilebilir host kanıtı yok).

## Beklenen tüketici gereksinimleri (dokümantasyon)

- HTTPS, immutable release kimliği, manifest önce / shard sonra atomik yayın
- CORS ve Cache-Control: uzun ömürlü tile, manifest için sürüm pin
- Karışık sürüm koruması: manifest contentHash ve shard SHA-256
- Eksik dosya: fail-closed (runtime checksum)

## Üretim engelleri

- `human-approvals-required.json`: NATIONAL_DATASET_PROMOTION = NOT_AUTHORIZED
- PR #103 merge/publish yetkisi yok
