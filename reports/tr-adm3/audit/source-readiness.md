# Source readiness and licensing — 2026-10-08

Registry approval, downloadable candidate, imported snapshot, geometry QA, delivery publication and mobile selection are separate stages. [Machine stage inventory](source-pipeline-stages.json) covers 162 provincial source registrations; [exact imported snapshot checks](official-source-fidelity.json) cover four local providers. No license approval was promoted into production eligibility in this sprint.

| Source             | Current audit evidence                                                                                             | Readiness                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Bursa              | 1,074 locked records, source date 2025-03-19; source file hash and existing adapter verified                       | Existing approved imported candidate; source fidelity changes must remain explicit          |
| Gaziantep          | 786 locked records, 2026-02-18; snapshot parsed and IDs retained                                                   | Existing approved imported candidate; current portal retrieval not independently successful |
| Kayseri            | 711 locked records, 2026-04-15; snapshot parsed and IDs retained                                                   | Existing approved imported candidate; current portal retrieval not independently successful |
| Ordu               | 772 locked records, 2025-08-01; snapshot parsed and IDs retained                                                   | Existing approved imported candidate; current license portal returned 502                   |
| Kadıköy            | Official 21-neighbourhood SHP, downloaded 21 polygon records, projected coordinates; no valid SHX/DBF/PRJ obtained | Comparison candidate only; BLOCKED_INCOMPLETE_SOURCE_BUNDLE                                 |
| Sakarya            | Registry candidate count 677, source date 2025-09-09, objectid/ad/ilce fields; public license page accessible      | Not imported; actual CRS/bundle and license linkage require review                          |
| Denizli            | Registry candidate count 620, source date 2025-08-14, KML FID/names lack parents; service has KIMLIKNO/ILCEID      | Not imported; service/package identity, parent mapping, license linkage unresolved          |
| Sivas              | Registry SHP ZIP candidate; count, fields and date unverified, prior timeouts                                      | Not imported; acquisition and license/bundle checks remain blocked                          |
| Konya              | Registry count 1,143, 2024 source, ADI_NUMARA names; missing native ID/parent field                                | Not imported; stable identity and parent assignments unresolved                             |
| OSM administrative | 81 candidate registrations; national source lock says not-built, zero loaded polygons                              | No measured administrative ADM3 coverage                                                    |
| OSM barriers       | Locked 2026-08-27 PBF SHA-256 5ec68ce5…; generated boundaries remain derived/non-administrative                    | Barrier input approval does not establish legal neighbourhood fidelity                      |
| MAKS / TUCBS       | Existing national authority/request paths; no verified public redistributable ADM3 polygon package                 | Request/access/license blockers; no actual polygon coverage inferred                        |

## Freshness and rights

[Bursa's current dataset page](https://acikyesil.bursa.bel.tr/dataset/mahalle-sinirlari) reports metadata updated 2026-08-27, later than the locked snapshot's source date and retrieval. This is a freshness signal, not proof that geometry changed. Its [license page](https://acikyesil.bursa.bel.tr/license) permits reuse, distribution, modification and commercial use with attribution and stated exclusions. Keep the locked download unchanged until a reviewed source diff exists.

[Sakarya's license page](https://veri.sakarya.bel.tr/license) permits broad reuse with attribution, while also containing a no-sublicensing clause and a version-change statement. Verify the exact downloaded dataset's linkage and distribution model before updating the existing review-required registry status. Denizli's current license fetch timed out. Failed live fetches do not invalidate previously locked approval, but they do not refresh its evidence.

## Kadıköy first Istanbul comparison

The [municipal dataset page](https://acikveri.kadikoy.bel.tr/tr/dataset/kadikoy-ilcesindeki-mahalle-sinirlari) describes 21 neighbourhoods and declares CC BY 4.0; the resource metadata dates it to 2025-02-20. [Resource](https://acikveri.kadikoy.bel.tr/tr/dataset/kadikoy-ilcesindeki-mahalle-sinirlari/resource/c7a8a9dc-c78f-417a-9e2c-42ec4d3436e7), [license terms](https://creativecommons.org/licenses/by/4.0/) support attribution, redistribution and adaptation subject to their terms.

Isolated acquisition returned HTTP 200, application/x-qgis, **103,260 bytes**, SHA-256 `4967957a2801fe70dbc565c030eae24d66e750762f06f247dc2d2fdb9e3c8946`. SHP header type 5 (Polygon), 21 record headers, end offset exactly 103,260. Bounds: [417104.4509, 4535415.4835, 425179.8921, 4542385.7568]. These are not longitude/latitude. No CRS was inferred from coordinate range.

Changing the download filename extension to .shx/.dbf/.prj/.cpg returned the **same SHP hash and byte size** each time; HTTP success does not verify companion files. [Acquisition evidence](kadikoy-acquisition.json). Python's default certificate store failed, then system curl successfully fetched the resource without disabling TLS verification. Files remain in ignored `.territory/quality-source-audit/kadikoy/`; no existing source lock was replaced.

Required before integration: obtain genuine SHP+SHX+DBF, authoritative PRJ/WKT and character encoding; inspect neighbourhood names/native IDs, enforce 21-record consistency, map exact canonical Kadıköy parent, use explicit supported reprojection, check topology/containment/overlap against an unchanged source copy, save acquisition and license-page checksums and attribution/change notices. Topology, identities, exact CRS, complete reproducible bundle and effective/source comparison are currently unverified. No production-ready claim.

Recorded Sakarya/Denizli/Sivas/Konya counts are discovery expectations only; this sprint did not download and approve their geometries. Registry notes saying the importer is 4326-only are stale: current code supports CRS84 and EPSG:3857 as well; unsupported projected systems still require an explicit adapter.
