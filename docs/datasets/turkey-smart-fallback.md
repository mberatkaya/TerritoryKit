# Turkey Smart Fallback Boundary Engine

The Turkey smart fallback boundary engine creates deterministic ADM3 playable zones when neither a
reviewed official ADM3 polygon nor a usable OSM administrative ADM3 polygon is available for an
ADM2 district. It is a derived fallback. It does not create official mahalle or köy records.

Published smart fallback zones are labeled:

- `sourceClass: "generated"`
- `boundaryKind: "estimated"`
- `boundarySourceClass: "smart-derived"`
- `semanticType: "generated-zone"`
- `administrative: false`
- `official: false`
- `generated: true`
- `algorithmVersion: "smart-derived-v1.2"`

## Source Priority

Turkey V2 keeps the same resolver order:

1. reviewed official ADM3 polygons
2. OSM administrative ADM3 polygons, where explicitly built and license-approved
3. standard smart-derived generated fallback
4. organic low-confidence Smart when standard quality gates reject the result

Unsafe organic output returns an explicit failure. Legacy generation requires an explicit
developer emergency option and cannot pass normal national publish-ready validation.

Lower-priority geometry is clipped by higher-priority geometry. Smart fallback is only allowed to
fill the remaining missing ADM2 area.

## Barrier Inputs

The engine accepts provider-neutral GeoJSON `FeatureCollection` inputs for:

- roads
- railways
- water
- landuse
- parks
- optional locality seeds

It reads common OSM-style tags such as `highway`, `railway`, `waterway`, `natural`, `landuse`, and
`leisure`, but the algorithm does not require the source files to be live OSM downloads. Major
roads, rivers, railways, coastlines, forests, and parks can become split candidates. Service roads,
driveways, parking aisles, paths, and other weak tags are ignored or scored too low to publish a
multi-territory result by themselves.

Production Turkey builds can now get those provider-neutral inputs from the OSM barrier snapshot
pipeline instead of hand-authored fixtures:

```text
Geofabrik Turkey PBF
  -> SHA-256 source lock
  -> deterministic road/rail/water/park/landuse extraction
  -> ADM2 clipping
  -> reusable barrier artifact
  -> smart fallback input
```

See [Turkey OSM barrier snapshots](./turkey-osm-barrier-snapshots.md). This snapshot pipeline is
the production path for OSM-derived barriers; live Overpass remains a development/debugging tool,
not a production build dependency.

## Profiles

Profiles tune target zone density and quality expectations:

- `dense-urban`
- `urban`
- `suburban`
- `rural`
- `auto`
- `custom`

`auto` uses ADM2 area, barrier density, and locality seed count to select a concrete profile.
Locality seeds are hints, not a hard target-zone floor. Dense and urban profiles require compact
ADM2 parent area as well as density signals, so large rural districts with many OSM place nodes do
not accidentally become dense-urban builds. Custom builds can set target count, target area,
min/max area, barrier strength, synthetic split limits, and quality gate thresholds.

## Quality Gates

A smart fallback result is publishable only when all gates pass:

- coverage of the missing ADM2 geometry
- invalid geometry count
- sibling overlap
- spill outside the ADM2 parent
- real barrier sufficiency for multi-territory results
- mean quality score
- mean barrier alignment
- synthetic split limit

Synthetic splits are a last resort and default to a rejected result when used. This prevents a weak
or empty barrier network from silently becoming a publishable grid.

## Diagnostics

`quality-report.json` carries both gate-level metrics and raw evidence:

- `inputDiagnostics` records raw and normalized road, major-road, rail, water, park, landuse, and
  locality seed counts, plus parent-edge barriers ignored before generation.
- `coverageComputation` records whether aggregate union succeeded, the raw covered/uncovered/spill
  and overlap areas, and the small parent-area-capped topology tolerance used to normalize clipping
  noise before gates.
- `meanBarrierAlignment` is the global internal-boundary real-barrier ratio. It is computed in
  meters with projected interval overlap against real OSM-style barrier segments.
- `meanZoneBarrierAlignment`, `meanRealBarrierRatio`, `meanSyntheticBoundaryRatio`,
  `totalInternalBoundaryLengthKm`, and `barrierAlignedBoundaryLengthKm` explain how much of the
  generated internal boundary is supported by real barriers.

Public `coveragePercent` is normalized to `[0, 100]` after the existing topology-noise
normalization. Quality gates and CLI reports use this public value. The unclamped intersection /
parent area percentage remains in `coverageComputation.rawCoveragePercent`, alongside raw areas.
For example, a raw `100.000247` percent is reported publicly as `100`. Public
`uncoveredInsideParentKm2`, `outsideSpillKm2`, and `overlapAreaKm2` remain nonnegative; raw topology
values remain available for auditing. This does not change gate thresholds, score weights, or the
50 m alignment tolerance. Hybrid `quality.smartAttempt.coverageComputation` preserves this evidence
when standard Smart rejects and the organic stage is evaluated.

Rejected smart attempts now emit explicit issue codes for each failing gate, including
`SMART_FALLBACK_ALIGNMENT_TOO_LOW`, `SMART_FALLBACK_COVERAGE_TOO_LOW`,
`SMART_FALLBACK_SPILL_TOO_HIGH`, `SMART_FALLBACK_GEOMETRY_INVALID`,
`SMART_FALLBACK_COORDINATE_ORDER_INVALID`, and `SMART_FALLBACK_QUALITY_REJECTED`.

Sprint 5.1 calibrated the diagnostics on a locked real Fatih artifact from the Geofabrik Turkey
snapshot `5ec68ce5e0b2be55b2c34ee7cd1ff91b6b3d8db8acab5a6be2fa7beb633eaedc`
(`2026-08-27T20:21:06.000Z`). The old Fatih smart attempt produced 105 zones with `coverage=0`,
`spill=16.362399 km2`, `meanBarrierAlignment=0.000824`, and `meanQuality=0.38882`. After the
calibration, Fatih produces 47 smart-derived zones with `coverage=99.999548`,
`outsideSpill=0`, `overlap=0`, `meanBarrierAlignment=0.266414`, and `meanQuality=0.622904`
without lowering quality thresholds.

Final multipolygon hardening also corrected native Node ESM polygon clipping. Rebuilding Fatih
from the same locked snapshot restores 140 parks, 39 landuse polygons, and 60 water features
(previously 0, 0, and 45). Smart remains accepted with 47 territories, `coveragePercent=99.999505`,
`outsideSpillKm2=0`, `uncoveredInsideParentKm2=0.000121`, `meanBarrierAlignment=0.286977`,
`meanQualityScore=0.625907`, and zero synthetic splits. Raw coverage is `99.999505`; raw spill
`0.000009 km2` and overlap `0.000015 km2` remain in diagnostics while public areas normalize this
sub-tolerance noise to zero. Thresholds and source semantics are unchanged.

## CLI

```bash
territory tr adm3 generate \
  --strategy smart \
  --district ./district.json \
  --roads ./roads.geojson \
  --water ./water.geojson \
  --railways ./railways.geojson \
  --locality-seeds ./seeds.json \
  --profile auto \
  --output ./.territory/smart-fallback \
  --force
```

Smart builds write the normal generated artifacts plus:

- `manifest.json`
- `comparison.json`

Use `--dry-run` or `--plan` to inspect the resolved configuration and normalized barrier summary
without writing artifacts. Use `--no-legacy-comparison` to skip the comparison artifact.

## Reproducibility

The manifest records input hashes for the ADM2 parent geometry, barrier layers, and locality seeds.
Zone IDs include the smart fallback algorithm version and deterministic generation seed, so a future
algorithm change can coexist with existing generated-zone IDs.

If OSM-derived barriers are used, output metadata keeps ODbL attribution. If non-OSM provider
snapshots are supplied, pass `--source-provider`, `--source-dataset-id`, `--source-url`,
`--license`, and `--attribution` so provenance and redistribution policy remain auditable.
When OSM barrier artifacts are used, smart provenance links the generated geometry hash back to the
barrier artifact checksum, OSM snapshot checksum, provider URL, and ODbL attribution.

## Sprint 6 Organic Profile And Grid Gate

Normal national production selects approved official-national, approved official-local, verified
OSM administrative, standard Smart, then organic low-confidence Smart. Legacy axis-aligned grids
are disabled. Historical legacy generators remain available for fixtures and explicit developer
emergency builds.

Organic Smart uses a bounded farthest-point sample of validated locality seeds and real road/rail/
water/landuse network vertices, with locality input first. It constructs Voronoi cells in a local
equirectangular metric and clips each cell once to the true missing parent geometry. No lat/lon
grid or recursive rectangle subdivision is used. Geometry, coverage, overlap, spill, area, and
finite-coordinate validation remain hard gates. Organic certainty thresholds are separate from
standard Smart: minimum mean score 0.25, no minimum barrier alignment, maximum cell area at least
one quarter of the missing parent area, and at most 64 cells. Sparse real inputs or invalid cells
produce explicit rejection. This coarse gameplay mode does not identify real mahalle records.

## Final Geographic Calibration

`smart-derived-v1.2` treats Voronoi as a **coarse ownership partition**. It then routes shared
boundaries along real OSM corridors and validates the resulting partition. Voronoi alone is not
evidence of real-barrier adherence. Standard Smart retains its existing geometry selection.

Small connected missing-region components are kept whole when the existing area limits allow
it. For multipart gaps, ownership uses the largest coarse overlap share and respects the
maximum territory area and count; detached parts remain detached, with no invented connector.
This avoids dividing already bounded geographic fragments merely to meet a coarse cell target.
The component optimization is discarded if either unsupported-axis or unsupported-straight
ratio would increase. Components that cannot be safely regularized at delivery precision retain
their existing subdivision. Routed replacements also pass this precision safety check.

Organic starts with a target of 16 coarse cells below 3 km/km² road density and 32 otherwise,
subject to the existing target-area minimum. Realism rejection can retry 16 and then 8 targets
without relaxing maximum area, the 64-cell cap, topology or realism gates. Oversized cells still
receive bounded geographic subdivision. This avoids inventing unnecessary seams in sparse networks.

The stage indexes normalized segments per ADM2. Interior junctions shared by three or more cells
can move once to a nearby real network junction; all incident owners change atomically. Boundary,
coastline and official-mask junctions remain fixed. Each unsupported shared edge searches a local
graph of actual road, rail and water vertices, with projected endpoint anchors. Graph connections
respect available `layer`, `bridge` and `tunnel` tags; geometric crossings alone do not create
connections. Existing normalized strengths weight physical length, weakness and departure from
the coarse edge. Tie ordering is stable. Weak local streets have a higher cost than strong barriers.

Search width is capped at 40% of chord length and at 400 m, 2 km or 5 km for road density at least
15, at least 3, or below 3 km/km², respectively. Junction movement also stays within 40% of the
shortest incident edge. Density and locality signals use the actual missing geometry, not the
whole district when official polygons mask it. The routing graph excludes coastline as an internal
separator. A full route may be at most 1.8 times the chord and contain at most 40% connector length.
When no complete graph route exists, monotone portions of actual nearby paths can replace only
the portions they span. Local-road fragments need at least 250 m of real path and connectors at
most 20% of that length; stronger fragments need at least 100 m and connectors at most 50%.

Both owners receive the same path. A replacement is committed only when polygon Boolean
operations prove that their union is unchanged, they do not overlap, and rings do not cross.
Topology failure retains the original edge. Final coverage, geometry, area, overlap and spill gates
remain in force. No arbitrary curvature is added to make unsupported geometry appear organic.

The existing `meanRealBarrierRatio` / `meanBarrierAlignment` retain their strength-qualified
semantics (`minAlignmentStrength`, default 0.45). `meanSyntheticBoundaryRatio` remains their
complement. The new `barrierFollowingInternalBoundaryRatio` uses the same proximity, heading
compatibility and interval-overlap calculation for **all non-ignored real barriers**, including
weak residential roads. These measures are reported separately; proximity alone never supplies
alignment, and the existing 50 m tolerance is unchanged.

`longUnsupportedStraightBoundaryRatio` measures unsupported chains at any angle. Consecutive
segments within three degrees of the initial heading form a chain; chains at least 100 m long
contribute unsupported length. Real overlap from all non-ignored barriers is subtracted. Parent
edges break chains and remain excluded. Densifying a diagonal ruler does not evade the metric.
The Organic `geographicRealism` gate rejects ratios above 0.8, or above 0.95 when actual road
density is below 3 km/km². The independent 0.15 unsupported-axis gate is retained. Sparse inputs
can still fail explicitly; estimated coverage is never silently replaced with a production grid.

Barrier extraction `tr-osm-barriers-v1.3` fixes degenerate closing-ring containment and keeps
valid line endpoints on official-mask hole boundaries. This extraction change requires rebuilding
affected artifacts from the original locked snapshot; cached source extracts remain reusable.
Pure routing changes do not otherwise invalidate extraction. Smart algorithm and configuration
identities invalidate previous generated district checkpoints.

`axisAlignedInternalBoundaryRatio` is a length ratio in `[0,1]`. It measures unsupported internal
segments at least 100 m long whose angle is within one degree of latitude/longitude axes. Parent
edges are excluded. Support from real non-ignored barriers (including weak local roads) is
subtracted using the existing 50 m alignment tolerance. A ratio above 0.15 rejects either Smart
mode. Real north/south or east/west roads are not counted as synthetic grids.

The existing confidence values are `authoritative`, `high`, `medium`, and `low`. Approved official
geometry uses authoritative confidence; reviewed OSM administrative geometry uses high confidence.
Standard Smart remains medium or low according to its existing quality score. Organic Smart is
always `low`, `gameplayOnly: true`, `administrative: false`, `authoritative: false`, and estimated.

See [nationwide candidate evidence](./turkey-sprint-6-nationwide.md).

An organic maximum-area rejection can retry with existing geographic boundary vertices and
real network coordinates clipped to the gap. These remain low-confidence gameplay guidance.
The retry retains the original area and topology gates, and never uses recursive generated
Voronoi vertices as source points. Exact self-crossings introduced by decimal snapping are
regularized with polygon self-union before the same hard checks run.

The current `2.1.0-rc.2` calibration candidate is **not publish-ready**: 949/973 districts pass,
24 fail and seven are unavailable. Two precision exceptions omit 58 approved polygons.
The accepted historical artifact remains unchanged. See [national calibration outcomes](./turkey-sprint-6-nationwide.md#final-geographic-calibration).
