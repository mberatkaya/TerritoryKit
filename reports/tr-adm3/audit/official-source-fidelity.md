# Official source fidelity

Inspected base `c6c8c4638228a2c14c98f6cb37af95c23f5fdf7a`. [Executed comparisons and adapter reports](official-source-fidelity.json); [artifact hashes](artifact-evidence.json). No official geometries or stable IDs were edited.

| Source    | Expected | Locked source parsed | Imported | Effective | Native ID / parent field | CRS           |
| --------- | -------: | -------------------: | -------: | --------: | ------------------------ | ------------- |
| Bursa     |    1,074 |                1,074 |    1,074 |     1,074 | KIMLIKNO / ILCEID        | EPSG:4326     |
| Gaziantep |      786 |                  786 |      786 |       786 | KIMLIKNO / ILCEID        | EPSG:4326 KML |
| Kayseri   |      711 |                  711 |      711 |       711 | CBNO / ILCE_CBNO         | OGC:CRS84     |
| Ordu      |      772 |                  772 |      772 |       772 | MAHALLE KODU / İLÇE ADI  | OGC:CRS84     |

All four exact upstream snapshot hashes/byte sizes match their source lock. Existing adapters accepted all 3,343 records, with zero rejected/unresolved records, duplicate stable source IDs or duplicate parent/name pairs. All source-native IDs occur in the effective candidate and all imported stable IDs survive. This establishes snapshot retention, not completeness against a current authoritative neighbourhood roster. Exact source dates, retrieval dates and license evidence are in JSON. Raw source bytes remain outside Git.

## Changes and the meaning of preservation

Independent counts from current metadata reproduce **1,901 original/effective geometry hash changes**, **1,328 parent clipping flags**, **534 positive internal removals**, and **5 parent reassigments**. `removedByPriorityAreaKm2` is zero for official features; the 534 count is `removedAreaKm2`, associated with same-source overlap resolution. The earlier report's 2,094 bytewise historical-2.0 geometry retention claim was not independently compared with that separate artifact during this audit.

Parsed coordinate serialization changes for **3,339** imported → effective geometries. SHA-256 of stable JSON key serialization also changes for 3,339; this comparison does not normalize ring rotations or Polygon/MultiPolygon representation. **1,624** have spherical area change above 1 m². A hash change can reflect normalization as well as boundary edits; area equality alone cannot prove shape equality. Do not substitute these measurements for the historical normalized 1,901 metric.

The raw imported artifact `.territory/build/TR/ADM3/official/levels/ADM3/dataset.json` is an adapter-normalized canonical source snapshot. Upstream-original GeoJSON/KML downloads are separately locked. Effective gameplay geometries are `.territory/sprint-6/final/candidate/levels/ADM3/dataset.json`, with original/effective hashes, source native IDs and clipping metadata. Keeping only effective geometry is insufficient for source-fidelity delivery.

| Native ID / name  | Reported → effective parent |             Effective/raw area |
| ----------------- | --------------------------- | -----------------------------: |
| 30464 İNÖNÜ       | Oğuzeli → Şahinbey          | 100% within floating precision |
| 30465 ŞAHİNBEY    | Oğuzeli → Şahinbey          |                    99.9999988% |
| 30466 MİMAR SİNAN | Oğuzeli → Şahinbey          | 100% within floating precision |
| 150891 GÜMÜŞKÖY   | Altınordu → Kabadüz         |                    98.0655315% |
| 150909 KUYLU      | Altınordu → Kabadüz         |                    99.2276848% |

[Comparison JSON](official-source-fidelity.json) identifies all five unchanged territory IDs, exact parent IDs and areas. Correction interpretation is consistent with the prior recorded parent-correction report. Legal parent reassignment still needs authoritative confirmation rather than coordinates alone. The small ŞAHİNBEY area delta differs from the prior report's exactly-retained-area presentation; this audit reports the present bytes.

## Provenance gaps

Official `sourceSnapshotChecksum` in candidate zone metadata can equal a per-geometry hash (e.g. Bursa AKÇAPINAR). It is not the upstream downloaded file checksum. The coverage inventory preserves this metadata and explicitly labels its meaning; source-level checksums in the JSON audit are the reproducible acquisition identity.

National parent metadata says geoBoundaries while the national lock describes HDX. This discrepancy is independent of official municipality license approval. Follow-up must pin the exact parent input bytes, retain source-native parent assignments and preserve the separate effective parent correction log. Do not relabel clipped geometry as an unchanged legal boundary, flatten islands, or normalize legitimate official shape irregularities merely to improve gameplay appearance.
