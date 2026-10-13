# Rush&Claim — Sprint 4 entegrasyon handoff

## Dataset kimliği

| Alan                        | Değer                                                                   | Kanıt                  |
| --------------------------- | ----------------------------------------------------------------------- | ---------------------- |
| datasetId                   | territory-kit-tr-v2-playable                                            | manifest.json          |
| datasetVersion              | 2.1.0-rc.7                                                              | manifest.json          |
| canonicalGeometryHash       | fb19b468c0555dd0e167d5937037b1609f610014d9231c80b4bc9834685dd8f3        | REAL_ARTIFACT_VERIFIED |
| sourceLockHash              | sha256:4cea41524fefc36670b21934840e932e8d3fcc075e46059f09dc839345b6a85c | REAL_ARTIFACT_VERIFIED |
| deliveryManifestContentHash | 4c1d42a082a63f5170a63ce150a1e3c5abbe4486ec4dbf1ed3c43789088a31cb        | REAL_ARTIFACT_VERIFIED |
| adm3DatasetSha256           | 9426fe8519f17ed53b3927c394eb5bbf4245237ea7a8b7094bb8f1666c10207f        | REAL_ARTIFACT_VERIFIED |

## Artifact yolları (yerel)

- Kök: `.territory/sprint-6/final/candidate` (gitignore; CI'da yok)
- Teslimat manifesti: `delivery-manifest-hardened.json` (adm2Shards ile)
- MVT: `render/tiles/{z}/{x}/{y}.mvt`, katman `territory-adm3`, zoom 10–12

## Tüketici API

- `@territory-kit/runtime/turkey-v2-delivery` — `resolveTurkeyV2Boundaries`, `getTurkeyV2Attribution`, `getTurkeyV2Neighbors`
- `allowEstimated: false` → yalnızca resmi/onaylı zonlar; generated gameplay zonları sessizce dahil edilmez

## Sprint 2 carryover

- Kadıköy: BLOCKED_BY_SOURCE
- Eyüpsultan: düşük güven / NO_ROUTE kanıtı
- Kıyı/ada: verified water olmadan NOT_ASSESSED

## Yetkilendirme

- Production/hosted yayın: **NOT_AUTHORIZED**
- Path A/B: **NOT_AUTHORIZED**
- H3 silme veya ownership migrasyonu: reviewed mapping + production validation gerekir

## Sprint 4 minimum doğrulama

1. Manifest pin ve shard checksum
2. MVT + district shard birlikte test
3. Attribution ve lisans UI
4. Cache invalidation: datasetVersion + geometryHash + manifest contentHash
