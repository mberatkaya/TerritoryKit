# Sprint 6 Nationwide Smart Candidate

The tables below document the accepted `2.1.0-rc.1` baseline. Final geographic calibration targets
`2.1.0-rc.2`, with shared barrier routing in `smart-derived-v1.2`. Its measured outcomes are recorded
separately after a real national rebuild; baseline metrics are not recalibration results.

Sprint 6 prepares `territory-kit-tr-v2-playable@2.1.0-rc.1`. The historical `2.0.0` national
artifact is retained. This candidate is not an npm publication or an automatic consumer upgrade.

The production resolver preserves approved official-national, approved official-local, and verified
OSM administrative polygons, then fills only missing geometry with standard Smart or organic
low-confidence Smart. Legacy grids are disabled. Unsafe output records an explicit failure.

## Locked Source

- Provider: Geofabrik OpenStreetMap extracts.
- Snapshot: `2026-08-27T20:21:06.000Z`.
- SHA-256: `5ec68ce5e0b2be55b2c34ee7cd1ff91b6b3d8db8acab5a6be2fa7beb633eaedc`.
- Size: 643,317,882 bytes.
- License: ODbL 1.0; attribution: OpenStreetMap contributors.

The same original PBF is verified and used across all canonical ADM2 parents. No live Overpass
queries or mixed snapshot dates are used.

## Rebuild

```bash
pnpm --filter @territory-kit/generators build
pnpm --filter @territory-kit/cli build
node packages/cli/dist/index.mjs tr osm barriers build \
  --adm2 .territory/build/TR/V2-national/levels/ADM2/dataset.json \
  --source-lock .territory/cache/osm/TR/TR-5ec68ce5e0b2be55/source-lock.json \
  --output .territory/sprint-6/calibration/barriers --concurrency 2 --offline \
  --osmium-executable osmium
pnpm turkey:v2:national:publish-ready
pnpm turkey:v2:national:validate:publish-ready
```

`--osmium-executable` is optional. It accelerates bbox prefiltering with one native province extract
at a time and preserves complete supported barrier relations. It feeds the same portable parser,
relation assembler, normalization, and precise ADM2 clipping code. Native derivative files have
checksums linked to the original lock, configuration, bbox, and tool version. See the
[Osmium extraction manual](https://docs.osmcode.org/osmium/latest/osmium-extract.html).

Resume checks verify snapshot, algorithm, configuration, parent geometry, layer checksums, and
aggregate artifact identity. District results are checkpointed atomically and restored only when
all generation inputs, real-source geometry, build metadata, and result checksums match. Completed
results release input barrier geometry before national aggregation. Province and district artifacts
remain local or hosted assets, outside npm and Git. Each shard carries its own geometry hash;
`shards.json` records file hashes, sizes, and source-lock identity for strict validation.

## Geometry And Confidence

Organic fallback constructs parent-clipped Voronoi cells from a bounded sample of real locality
points and network vertices. It adds no invented administrative records or lat/lon grid points.
Oversized cells can be refined up to three times using real network paths clipped to the gap,
including points interpolated along those paths. If maximum-area checks still reject the first
organic result, a deterministic retry also samples existing vertices of the input geographic
boundary and clipped network coordinates. Refinement retains the original input vertices across
recursive calls; generated Voronoi vertices are not substituted as source guidance. This retry
retains the same maximum area, cell-count, coverage, topology and grid thresholds.
The profile remains estimated, generated, non-authoritative, non-administrative, low-confidence,
and gameplay-only. See [Smart quality and grid metrics](./turkey-smart-fallback.md).

Smart clipping intersections use ten decimal places. Hybrid difference operations retain original
precision and retry at a fixed sequence of twelve, ten, nine and eight decimal places only after
a clipping failure; failed retries abort explicitly. Union failures retry at twelve decimals and
then sequential unions, rather than treating overlapping input polygons as a valid union. All
resulting geometry passes the same final strict gates. Accepted Smart cells already partition the
real-source gap and retain that validated geometry rather than repeatedly cutting their shared
boundaries against a growing union. A self-union regularizes output only when decimal snapping
introduces an exact ring self-intersection; the final coverage, spill, overlap and geometry gates
run on the regularized output. Collinear clipping slivers are measured in a stable
local projection before spherical area calculations, preventing phantom spill area caused by
subdivision of a long parent edge. Geometry and spill thresholds are retained. Strict sibling overlap checks treat hole-boundary
contact as boundary contact, not interior overlap. This corrects false positives observed in two
Bursa districts whose exact polygon intersections were empty; a regression still rejects actual
interior overlap. Failed district checkpoints are retried, and district manifests expose Smart and
hybrid gates separately so an accepted Smart stage cannot hide a rejected district.

Standard Smart split passes cache the best candidate for each unchanged immutable piece and
reuse its canonical bbox. A candidate depends only on that piece and the fixed lines, seeds, and
configuration of the pass; the same score and tie ordering select it. Eight real representative
pilots retain their geometry hashes and tier choices across this optimization. Checkpoints record
original generation durations when available and report resumed reads separately; missing timing
measurements from older checkpoints are never inferred. Geometry hashing streams one zone at a
time while preserving the established hash bytes. Artifact checksums serialize one payload at a
time. Restored checkpoints intern byte-identical geometry shared by candidates and final datasets
to avoid retaining multiple coordinate copies.

## Results And Acceptance

The locked extraction covers all 973 canonical ADM2 parents. The final full build attempted and
completed 973 districts with zero failures, zero unavailable districts, zero production legacy
districts and zero unsupported-axis threshold violations. All 81 province shards and 973 district
shards pass strict publish-ready validation.

| Source                       |                                   Selected districts | ADM3 zones |  Area contribution |
| ---------------------------- | ---------------------------------------------------: | ---------: | -----------------: |
| Approved official-local      | 0 wholly official; contributes to 61 mixed districts |      3,338 |          4.993659% |
| OSM administrative           |                                                    0 |          0 |                 0% |
| Standard Smart               |                                                   13 |        412 |          0.019004% |
| Organic low-confidence Smart |                                                  960 |     30,503 |         94.987341% |
| Total                        |                                                  973 |     34,253 | approximately 100% |

No OSM administrative ADM3 artifact was available; real OSM barriers and locality inputs are not
counted as administrative records. Official polygons remain present in mixed districts, including
183 official polygons plus 30 organic polygons in Şahinbey. The raw national area-based coverage is
100.000003% due to area-estimator/rounding drift; raw contributions are retained in evidence.
Every district passes the 99.99% coverage floor and the original hard topology gates.

The actual pilot results are:

| Pilot                     | Tier               | Zones | District coverage | Spill km² | Barrier alignment | Synthetic boundary ratio | Unsupported axis ratio |
| ------------------------- | ------------------ | ----: | ----------------: | --------: | ----------------: | -----------------------: | ---------------------: |
| Fatih                     | Standard           |    47 |              100% |         0 |          0.289380 |                 0.710620 |                      0 |
| Gebze                     | Organic            |    32 |        99.999989% |         0 |          0.025857 |                 0.974143 |               0.041939 |
| Kangal                    | Organic            |    33 |              100% |         0 |          0.001417 |                 0.998583 |               0.038528 |
| Bodrum                    | Organic            |    33 |              100% |         0 |          0.012849 |                 0.987151 |               0.033084 |
| Karaman merkez, largest   | Organic            |    33 |              100% |         0 |          0.004024 |                 0.995976 |               0.026795 |
| Güngören, smallest        | Standard           |    21 |        99.999576% |         0 |          0.234637 |                 0.765363 |                      0 |
| Prince Islands, irregular | Organic            |    14 |        99.999895% |         0 |          0.043015 |                 0.956985 |               0.107697 |
| Şahinbey, mixed urban     | Official + Organic |   213 |              100% |         0 |                 0 |                        1 |                      0 |

The cold full command took 2,149.50 seconds (35 minutes 49.50 seconds), with peak RSS
7,854,063,616 bytes. All 973 districts were newly generated and timed: P50 1,147 ms,
P95 5,594 ms. A same-input warm command restored all 973 checkpoints, generated zero districts,
and took 339.96 seconds (5 minutes 39.96 seconds), with peak RSS 8,661,778,432 bytes.
Warm assembly still rebuilds national render and metadata artifacts.

The 10/100 district benchmark passed in 28.059/192.837 seconds with peak RSS
1,734,279,168/2,376,581,120 bytes. Those benchmark scenarios omit MVT generation and the old
national migration baseline. Extraction timing describes the measured final continuation
(921 reused, 52 newly extracted), not an unrecorded full cold extraction.

The candidate contains 18,855 MVT tiles (45,704,060 bytes), with zero corrupt tiles or missing
zooms and a passing delivery policy. The 1,054 canonical shards total 763,015,463 bytes.
The complete local candidate, including checkpoints, occupies 3,241,956,454 bytes; its largest
artifact is the 384,299,558-byte national dataset. Normalized source barriers occupy a separate
7,061,094,971 bytes.

The full rerun preserves the source-lock, national geometry hash, Smart coverage hash, shard
manifest hash, tier decisions and totals. Of 18,878 core artifact checksums, 18,877 match exactly;
the only varying file is the MVT policy report's measured duration field. Every MVT delivery tile
is identical. Eight independently regenerated representative pilots also retain identical geometry
and deterministic hashes. A fresh Fatih barrier extraction matches its previous checksum, with
all 973 barrier artifacts verified against the same lock.

The [checked-in national evidence](../../reports/baselines/sprint-6-national.json) includes all 81
province outcomes, representative metrics, source identities, migration counts, artifact sizes,
performance scopes and PASS statuses. Large geometry, PBF files, caches and map previews remain
local under `.territory/`; no npm or CDN publication is performed. Local visual evidence contains
parent boundaries, major OSM barriers and final zone layers for the eight pilots.

The official-source backlog puts unavailable output first, then license-related diagnostics and
insufficient-barrier reasons, then lower measured Smart quality and higher unsupported-axis ratios.
Ties use stable ADM2 IDs. Population is not fabricated when source metadata does not provide it.

## Migration

The old national artifact is passed explicitly through `--migration-baseline`. Existing migration
infrastructure maps each district using intersection areas, old/new shares, IoU, split/merge and
manual-review evidence. Review ambiguous mappings before switching persisted gameplay state.

The unchanged historical baseline has 42,210 zones. Migration produces 3,099 overlap-component
records: 2,094 preserved, 991 source-replaced, 13 split and one merged. There are 988 many-to-many
components and 1,005 records requiring manual review. Pairwise intersection areas, old/new shares,
IoU, algorithm versions and source classes are retained; this is evidence for an explicit migration,
not an automatic persisted-state upgrade.

## Final Geographic Calibration

The separate `2.1.0-rc.2` candidate is **DO NOT MERGE**. All 81 provinces and 973
ADM2 were attempted, but only 949 districts pass final acceptance: 24 fail and seven have no
ADM3 output. Standard Smart contributes nine districts and Organic Smart 940; 59 districts
have approved official contributions and none have verified OSM administrative contributions.
Production legacy remains zero. There are 22 unsupported-straight violations and three axis
violations, with the axis failures included among the 22. National coverage is 99.522542%.

Gölköy and Sarıoğlan fail with `SMART_FALLBACK_PRECISION_REGULARIZATION_FAILED`. Their missing
district results omit 58 approved polygons compared with rc.1. All retained official geometries
are identical, including Şahinbey's 183 approved polygons, but global official completeness is
not preserved in this candidate. These exceptions and the 22 failed missing-region partitions
must be resolved before replacing the accepted artifact. No acceptance gate was relaxed.

The pipeline is coarse Voronoi ownership → real barrier graph routing → atomic shared-edge
replacement → topology validation. Voronoi alone is not evidence of real-barrier adherence.
See [the routing and measurement contract](./turkey-smart-fallback.md#final-geographic-calibration).
The [checked-in calibration evidence](../../reports/baselines/sprint-6-geographic-calibration.json)
contains all 973 outcomes, failed-gap input diagnostics, worst-20 rankings, before/after pilots,
source identities, migration, performance, validation failures and determinism evidence.
The accepted rc.1 tables and evidence above remain historical baseline results.

### Geographic distributions

These are per-district ratios for the selected Standard/Organic tiers (9 and 940 districts).
Rejected partitions remain in the separate complete outcome/backlog lists. No-internal-seam
cases remain in distributions but are excluded from worst-boundary rankings.

| Tier           | Metric                                | Min      | P10      | Median   | P90      | Max      |
| -------------- | ------------------------------------- | -------- | -------- | -------- | -------- | -------- |
| standard-smart | realBarrierRatio                      | 0.200552 | 0.23521  | 0.311919 | 0.598412 | 0.874358 |
| standard-smart | syntheticBoundaryRatio                | 0.125642 | 0.401588 | 0.688081 | 0.76479  | 0.799448 |
| standard-smart | longUnsupportedStraightBoundaryRatio  | 0        | 0        | 0.616186 | 0.705482 | 0.755925 |
| standard-smart | axisAlignedInternalBoundaryRatio      | 0        | 0        | 0.009697 | 0.041604 | 0.043746 |
| standard-smart | barrierFollowingInternalBoundaryRatio | 0.237952 | 0.286695 | 0.381068 | 0.598412 | 0.874358 |
| organic-smart  | realBarrierRatio                      | 0        | 0.090883 | 0.210083 | 0.340137 | 0.521606 |
| organic-smart  | syntheticBoundaryRatio                | 0.478394 | 0.659863 | 0.789917 | 0.909117 | 1        |
| organic-smart  | longUnsupportedStraightBoundaryRatio  | 0        | 0.585016 | 0.748098 | 0.886272 | 0.948714 |
| organic-smart  | axisAlignedInternalBoundaryRatio      | 0        | 0        | 0.00154  | 0.048114 | 0.137166 |
| organic-smart  | barrierFollowingInternalBoundaryRatio | 0        | 0.102118 | 0.241766 | 0.395282 | 0.776637 |

### Pilots, delivery and determinism

All eight parent/OSM/territory comparison maps were manually inspected. Strong support improves
from 0.026 to 0.267 in Gebze, 0.001 to 0.179 in Kangal and 0.013 to 0.253 in Bodrum. Fatih
stays Standard with 47 zones and improves from 0.289 to 0.301. Adalar remains detached across
the sea. Şahinbey's approved polygons are unchanged; only its true missing region differs.
Every pilot has 100% coverage, zero spill and zero overlap. Substantial unsupported rural and
sparse-gap seams remain visible; these maps do not establish nationwide product acceptance.

Eight independently regenerated pilots match the national candidate exactly. The complete
repeat preserves source-lock, geometry, tier decisions, coverage totals and shard identities.
All 18,832 delivery tiles match byte checksums. Of 18,855 core artifact checksums, 18,854 match;
the sole difference is the documented MVT policy report's `levels[].durationMs` field. MVT
validation reports zero corrupt tiles, no missing zooms, 40,278,259 bytes total and a maximum
112,535-byte tile, within the existing size policy. Valid tiles do not make this incomplete
candidate publish-ready; both normal and publish-ready national validation fail.

### Migration and performance

Historical 2.0.0 → rc.2 evidence contains 3597 overlap-component records:
2064 preserved, 953 source-replaced,
570 removed, 9 split and 1 merged.
There are 952 many-to-many components, 1533
manual-review records and 99327 pairwise intersections. IoU and old/new
area shares are retained. Removal records include failed output, so this evidence must not be
applied as an automatic gameplay-state migration.

The cold run built 971 district results and recorded two exceptions, with zero resume. Its
observed wall time was 14,285.34 seconds, including a long inactive interval across a user
interruption; CPU time was 3,464.19 seconds. This wall measurement is not a controlled algorithm
benchmark. Peak RSS was 7,289,356,288 bytes; recorded generation P50/P95 were 1,782/14,060 ms.
The repeat took 493.82 seconds, resumed 949 accepted districts, rebuilt 22 rejected results and
reproduced two exceptions; peak RSS was 7,659,061,248 bytes. Candidate files including checkpoints
total 3,046,167,666 bytes. The bounded 10/100 cold scenarios took 77,755/352,828 ms, with RSS
1,565,491,200/2,063,253,504 bytes. The 10-district scenario passes; the 100-district scenario
fails because Çelikhan is unavailable. Routing adds graph/path/Boolean work; benchmark time
increases while recorded peak RSS remains below the rc.1 benchmark.

Recalibration commands explicitly use rc.2 and write under `.territory/sprint-6/calibration/`.
The same locked Geofabrik snapshot is used. Extraction `tr-osm-barriers-v1.3` corrects closed-ring
containment and hole-boundary line clipping; changed artifacts were rebuilt while native source
extracts were reused. An exact-cohort fresh Fatih extraction matches all hashes. No PBF, caches,
checkpoints, raster previews or multi-GB artifacts are committed. No npm/CDN publication,
automatic gameplay-state migration or PR merge occurs.

A bounded follow-up experiment enabled the existing geographic seed refinement for the 24 rejected
ADM2 IDs without changing any gate. It accepted 8 cases, but remaining ruler/axis failures
and Sarıoğlan’s precision exception still block nationwide acceptance. This experiment was not
promoted to the frozen routing-v8 candidate; its per-district results are recorded separately in
the calibration evidence.

## Sprint 6 final acceptance candidate

`2.1.0-rc.3` uses `smart-derived-v1.3` for generated geometry. Approved official and verified
OSM administrative polygons remain independent of generated-gap success; a generation exception
retains accepted real-source zones and reports the uncovered gap. Exact self-union intersection
coordinates repair the captured Gölköy and Sarıoğlan precision loops without rewriting approved
source polygons. Source preservation is a publish-ready gate.

Both Standard and Organic Smart now report geographic realism, nearby usable corridor
opportunity, routing utilization, and unsupported straight-chain lengths. Organic output uses the router's existing 40% connector budget as a hard unsupported-straight
ceiling. Standard output retains its established 0.8 ceiling while also comparing actual
barrier use with local corridor opportunity. Generated zones remain estimated
playable territory, never official mahalle records.

The complete repository-source Istanbul cohort has 39 ADM2 districts. The source names Adalar
“Prince Islands”; this is a naming mismatch, not an extra or missing district. The
[Istanbul acceptance report](../../reports/baselines/sprint-6-istanbul-39.json) records each
district's build and QA status. All 39 maps were reviewed: 11 pass, five pass with
low-confidence limitations, and 23 fail (including four machine-accepted outputs with visible
ruler seams). Istanbul blocks the full rc.3 national publish-ready run, so this candidate is
**DO NOT MERGE**. See the [24-district retest](../../reports/baselines/sprint-6-final-recovery.json)
(8 accepted, 16 rejected) and [national rc.3 status](../../reports/baselines/sprint-6-final-national.json).
The bounded rc.3 five-district national smoke also fails the district quality and coverage gates.
The historical rc.1 and rc.2 evidence above is retained separately.
