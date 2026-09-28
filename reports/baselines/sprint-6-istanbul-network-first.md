# Sprint 6 Istanbul Network First calibration (rc.5)

**Status: DO NOT MERGE.** This is an intermediate geography experiment on PR #76. The 39-district acceptance gate remains closed.

## Construction

The candidate clips normalized OSM barriers to the actual missing-generation geometry, nodes at-grade intersections with a Flatbush index, and polygonizes bounded real-network faces. It filters tiny faces, merges adjacent micro-faces with a strength-aware cost, and attaches small residual fragments only to adjacent validated zones. Larger residuals use the existing locality-guided Organic construction. Elevated bridge/tunnel/layer features are excluded from the planar face graph and remain available to the existing routing path. Standard and Organic remain candidates; the selector ranks accepted output by real-barrier following, synthetic ratio, longest unsupported seam relative to district scale, and quality.

Generated zones remain estimated, non-authoritative, non-administrative, and gameplay-only. The barrier extraction artifact remains `tr-osm-barriers-v1.3`.

## Measured Istanbul result

| Measure                          |     rc.4 |     rc.5 |
| -------------------------------- | -------: | -------: |
| Canonical ADM2 processed         |       39 |       39 |
| Machine accepted                 |       17 |       25 |
| Machine rejected                 |       22 |       14 |
| Generation exceptions            |        0 |        0 |
| Selected Network First           |        0 |       20 |
| Selected Organic                 |       17 |        5 |
| Selected Standard                |        0 |        0 |
| Network + residual Organic zones |        0 |        0 |
| Wall time                        |  244.1 s |  305.0 s |
| Peak sampled RSS                 | 1.65 GiB | 1.63 GiB |

Eight districts newly pass machine checks: Avcılar, Bakırköy, Beşiktaş, Kadıköy, Kartal, Küçükçekmece, Maltepe, and Sultanbeyli. No rc.4 machine-accepted district regressed. The 14 rejected districts are Arnavutköy, Başakşehir, Beykoz, Büyükçekmece, Çatalca, Çekmeköy, Eyüpsultan, Pendik, Sancaktepe, Sarıyer, Silivri, Sultangazi, Şile, and Tuzla. These remain real failures, not relaxed gates.

The 14 rejected districts have no selected output mode or zones; their report rows retain the rejected Organic candidate's diagnostics. Two unchanged-code runs matched all 39 selected modes, geometry hashes, zone counts, machine decisions, and recorded geographic metric fields. Wall times were 304.980 s and 305.338 s. The first run's P50/P95 district times were 5.904 s / 16.600 s; sampled peak RSS was 1.63 GiB and 1.45 GiB.

The 39 maps were rendered; selected maps were visually inspected against the rc.4 OSM overlay. Formal PASS/LOW labels remain incomplete while machine acceptance and water/forest behavior are unresolved. The current machine/manual mismatch target is therefore unverified.

## Fatih matched comparison

The three candidates use one parent, viewport, and OSM overlay in the tracked [Fatih three-way map](./sprint-6-fatih-three-way-rc5.png).

| Candidate           | Zones | Machine  | Following | Synthetic | Longest unsupported |
| ------------------- | ----: | -------- | --------: | --------: | ------------------: |
| Historical Standard |    47 | rejected |     37.0% |     69.9% |             1,741 m |
| rc.4 Organic        |    33 | accepted |     66.4% |     59.6% |               943 m |
| rc.5 Network First  |    30 | accepted |    100.0% |     10.9% |                 0 m |

The Network First map follows substantially more actual street and rail corridors. It was selected on measured quality, not territory count. The three-way map remains a visual review artifact, not proof that every edge is locally correct.

## Remaining blockers

- Large rural and mixed districts still lack sufficient closed graph faces within the bounded segment budget. Şile, Silivri, Çatalca, and Arnavutköy retain long rejected Organic seams.
- Sancaktepe and several mixed districts still fail geometry or realism checks when significant residual area requires Organic partitioning.
- The lake districts need an explicit land/water coverage policy before a machine pass can establish that generated polygons do not cover open water. Küçükçekmece and Avcılar require detailed shoreline review.
- Strong-barrier retention in selected dense districts is still low because gameplay-sized aggregation must cross many major graph edges. The graph needs better weak-road and locality-aware merging.
- QA maps do not yet distinguish retained network edges, residual routed edges, and synthetic connectors. Visual provenance review is incomplete. The residual connector length and residual synthetic boundary ratio diagnostics are also not yet implemented.
- The previous 24-failure cohort, 5/10/100 national ladder, full 973 build, national official-source hash audit, migration, and MVT validation remain gated behind Istanbul 39 acceptance.

Detailed district rows, candidate comparisons, diagnostics, and determinism counts are in [`sprint-6-istanbul-39.json`](./sprint-6-istanbul-39.json). The preserved rc.4 result is [`sprint-6-istanbul-39-rc4.json`](./sprint-6-istanbul-39-rc4.json).
