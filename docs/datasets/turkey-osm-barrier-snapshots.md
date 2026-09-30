# Turkey OSM Barrier Snapshot Pipeline

Sprint 5 adds the production data supply for the Turkey ADM3 smart fallback engine. Production
builds do not query live Overpass or the OSM API. They use a locked country-level OpenStreetMap
snapshot, verify the snapshot checksum, extract reusable barrier artifacts per ADM2 district, and
feed those artifacts into the existing Turkey V2 hybrid resolver.

## Architecture

Resolver priority:

```text
OFFICIAL ADM3
      |
      v
OSM ADMINISTRATIVE
      |
      v
OSM SNAPSHOT
      |
      v
BARRIER EXTRACTION
      |
      v
SMART FALLBACK
      |
      v
ORGANIC LOW-CONFIDENCE SMART
```

Data lineage:

```text
OSM Provider
    |
    v
Country PBF
    |
    v
SHA-256 source lock
    |
    v
Normalized barrier artifact
    |
    v
ADM2 clipping
    |
    v
Smart fallback
    |
    v
Generated geometry hash
```

The smart output is still estimated generated coverage, never an official mahalle or koy boundary.
Published smart-derived zones keep:

```text
boundaryKind: estimated
boundarySourceClass: smart-derived
administrative: false
authoritative: false
```

## Provider

The default provider is Geofabrik's Turkey country extract:

- provider id: `geofabrik-osm-extracts`
- source page: `https://download.geofabrik.de/europe/turkey.html`
- download strategy: `turkey-latest.osm.pbf`
- source dataset id: `geofabrik:europe:turkey`
- format: `osm-pbf`
- license: `ODbL-1.0`
- attribution: `OpenStreetMap contributors, ODbL 1.0`

The moving `latest` URL is only an acquisition pointer. Reproducibility is locked by SHA-256,
file size, source-lock metadata, and the cached content-addressed snapshot directory.

## Snapshot Acquisition

```bash
territory tr osm acquire --dry-run

territory tr osm acquire \
  --cache .territory/cache
```

Acquisition downloads the PBF to a temporary path, computes SHA-256, reads the PBF header for the
OSM replication timestamp when present, then writes:

```text
.territory/cache/osm/TR/<snapshot-id>/
  turkey.osm.pbf
  source-lock.json
```

Raw `.osm.pbf` snapshots are gitignored. The ADM3 artifact policy also fails if any raw PBF is
tracked in Git.

## Source Lock

`source-lock.json` uses `territorykit-tr-osm-snapshot-source-lock@1` and records:

- provider id/name
- country code
- source page URL
- acquisition URL
- source dataset id
- snapshot date
- download timestamp
- file size
- SHA-256
- license and attribution
- `osm-pbf` format
- content-addressed snapshot id
- cached PBF path
- selected PBF header metadata

Offline rebuilds must pass checksum verification before parsing:

```bash
territory tr osm verify \
  --source-lock .territory/cache/osm/TR/<snapshot-id>/source-lock.json
```

If the cached file hash differs from the lock, the CLI returns
`OSM_SNAPSHOT_CHECKSUM_MISMATCH` and does not silently replace the snapshot.

## Barrier Classification

The extractor uses `@osmix/pbf` and multi-pass streaming over the cached country PBF. Small
fixtures can still use the global extraction path. Real country snapshots use an ADM2 bbox
prefilter and province-sized batches so the portable Node.js pipeline does not materialize the full
national OSM node graph in memory. Each batch keeps relevant way/relation metadata touching the
selected ADM2 window, then resolves only needed coordinates.

Barrier layers:

| Layer    | OSM tags                                                                          | Role                         |
| -------- | --------------------------------------------------------------------------------- | ---------------------------- |
| roads    | `motorway`, `trunk`, `primary`, `secondary`, `tertiary`, links, weak local roads  | hard to medium barriers      |
| railways | `rail`, `light_rail`, `subway`, `tram`                                            | hard to medium barriers      |
| water    | `river`, `canal`, `stream`, `natural=water`, `natural=coastline`, lakes/reservoir | hard to medium barriers      |
| parks    | `leisure=park`, `leisure=nature_reserve`                                          | soft to medium barriers      |
| landuse  | `forest`, `cemetery`, `industrial`, `natural=wood`                                | soft to medium barriers      |
| seeds    | `place=neighbourhood`, `quarter`, `suburb`, `village`, `town`, `locality`         | locality seeds, not polygons |

OSM place nodes are seeds only. They are not promoted to ADM3 administrative polygons.

The built Node ESM pipeline resolves the polygon-clipping CommonJS default export before
intersection and hole-containment checks. `pnpm turkey:osm:multipolygon:smoke` verifies native ESM
relation extraction, ADM2 clipping, and hole preservation without network access; both `verify`
and the release readiness checks run it after building.

## Multipolygon Relations

Polygon-classified `type=multipolygon` and `type=boundary` relations use the same assembler for
parks, landuse, and water. Outer and inner member ways are stitched separately by OSM node ID;
reversed fragments are reversed when their end matches the current path. Already closed ways
remain rings. Stable way ordering, canonical ring orientation/start points, and sorted components
make geometry independent of relation member order. Distinct node IDs at identical coordinates
are not treated as connected.

Each inner ring is assigned to the smallest containing outer, checking the whole ring with polygon
difference so edges cannot cross a concave outer boundary. Disconnected outers produce separate
MultiPolygon components. Holes and `osm:relation:<id>` source lineage survive ADM2 clipping.
Spatial extraction first selects touching member ways, then resolves all member ways and needed
nodes for retained relations, including fragments beyond the selected district window.

Incomplete outer or inner rings, missing coordinates, and nested relation members reject the
whole relation geometry with an `OSM_MULTIPOLYGON_*` warning. Recursive nested relations are
currently unsupported. Orphan inner rings are omitted with `OSM_MULTIPOLYGON_ORPHAN_INNER`;
they are never silently dropped. Unrelated relation types are not promoted to polygons. Parser
`relationIssues`/`relationIssueCount`, build issues, and artifact quality issues retain the warnings
and source relation IDs. Artifact warnings describe the extraction batch and may include relations
outside an individual district. The `tr-osm-barriers-v1.2` algorithm version invalidates older cached
artifacts so an offline rebuild uses the complete assembler.

## ADM2 Extraction

Build barrier artifacts from a verified snapshot and a real ADM2 parent dataset:

```bash
territory tr osm barriers build \
  --adm2 .territory/build/TR/V2-national/levels/ADM2/dataset.json \
  --source-lock .territory/cache/osm/TR/<snapshot-id>/source-lock.json \
  --offline \
  --output .territory/build/TR/OSM-barriers \
  --concurrency 2
```

Dry run shows the provider, source URL, cache path, selected feature classes, ADM2 count, expected
operations, and sample output paths without downloading or parsing:

```bash
territory tr osm barriers build \
  --adm2 .territory/build/TR/V2-national/levels/ADM2/dataset.json \
  --source-lock .territory/cache/osm/TR/<snapshot-id>/source-lock.json \
  --dry-run
```

Each ADM2 artifact is written under:

```text
.territory/build/TR/OSM-barriers/ADM2/<adm2-id>/
  roads.geojson
  railways.geojson
  water.geojson
  landuse.geojson
  parks.geojson
  locality-seeds.json
  manifest.json
  quality.json
```

Line barriers are clipped to the ADM2 polygon by segment intersection and point-in-polygon checks.
Polygon barriers are intersected with the ADM2 geometry before serialization. Feature order,
property order, coordinate rounding, stable IDs, and artifact hashes are deterministic for the same
snapshot and code version.

Sprint 5.1 verified deterministic Fatih extraction by comparing the original real Fatih artifact
with a rerun from the locked Geofabrik snapshot. Both produced artifact checksum
`ee5e51ada406a7202fea7933cbd35de6554428567ce4ec1cc5772a0ed7d5864f`.

## Quality And Eligibility

`quality.json` includes:

- road, major road, rail, water, park, landuse, and locality seed counts
- total barrier length in kilometers
- major barrier length in kilometers
- input coverage confidence
- eligibility status
- machine-readable issues

An ADM2 is smart-eligible when the barrier artifact has enough major barriers, or a usable
combination of locality seeds and roads. Sparse inputs return `OSM_BARRIER_INPUT_INSUFFICIENT` and
requires the organic profile or explicit failure in normal national production.

Inspect one district:

```bash
territory tr osm barriers inspect \
  --barriers .territory/build/TR/OSM-barriers \
  --adm2 tr:adm2:example
```

## Smart Integration

`createTurkeyOsmSmartFallbackGeneratedOptions(artifact)` adapts a barrier artifact to the existing
Turkey V2 hybrid resolver:

```text
official ADM3
  -> OSM administrative ADM3
  -> OSM barrier artifact as smart fallback input
  -> organic low-confidence Smart or explicit failure
```

The adapter passes roads, railways, water, parks, landuse, locality seeds, ODbL attribution,
snapshot checksum, and artifact lineage into the smart fallback source metadata. It does not change
the smart fallback algorithm version or its non-authoritative semantics.

Nationwide smart coverage can be summarized with:

```bash
territory tr osm smart coverage \
  --adm2 .territory/build/TR/V2-national/levels/ADM2/dataset.json \
  --barriers .territory/build/TR/OSM-barriers \
  --output reports/tr-adm3/osm-smart-coverage.json
```

The report counts ADM2 totals, official coverage, OSM administrative coverage, smart-eligible
barrier artifacts, smart-generated results when supplied, smart quality rejections, insufficient
inputs, and a historical `legacyRequired` compatibility counter. That counter describes input
gaps; it is not permission to select legacy in Sprint 6 production. Use the national
`smart-coverage.json` manifest for actual standard/organic decisions and zero-grid enforcement.

## Historical Sprint 5.1 Calibration

The Sprint 5.1 real-pilot matrix used the locked Geofabrik Turkey PBF snapshot
`5ec68ce5e0b2be55b2c34ee7cd1ff91b6b3d8db8acab5a6be2fa7beb633eaedc`, dated
`2026-08-27T20:21:06.000Z`.

| ADM2   | Class                        | Barrier status | Hybrid fallback | Smart result                        |
| ------ | ---------------------------- | -------------- | --------------- | ----------------------------------- |
| Fatih  | dense urban regression       | eligible       | smart           | accepted, 47 zones                  |
| Gebze  | suburban metropolitan stress | eligible       | legacy          | rejected, maximum-area gate         |
| Kangal | rural sparse stress          | eligible       | legacy          | rejected, sparse alignment/topology |
| Bodrum | coastal stress               | eligible       | legacy          | rejected, maximum-area/alignment    |

The four-pilot barrier extraction processed 4 ADM2 artifacts in `543550 ms`, with max resident set
size `1198473216` bytes and all four artifacts eligible. The pre-hardening artifacts reported `parks=0` and `landuse=0`; those counts alone did not
establish source absence because fragmented relation assembly was incomplete and native ESM
polygon clipping used an incompatible export. Final hardening
rebuilds use the complete assembler. Parks and landuse remain optional soft barriers, with counts
visible in `inputDiagnostics`.

## Resume And Failure Modes

Barrier builds are resumable. An existing ADM2 artifact is reused before the PBF is parsed when
all match:

- `sourceSnapshotChecksum`
- `algorithmVersion`
- parent geometry SHA-256
- extraction configuration SHA-256
- every layer checksum and the aggregate artifact checksum

Use `--force` to rebuild. Full nationwide builds are processed in deterministic province-oriented
batches, with `--concurrency` controlling ADM2 artifact writes inside each batch. The default mode is
strict, so the first serious ADM2 processing error fails the command. `--best-effort` records
`OSM_BARRIER_ADM2_PROCESSING_FAILED` and continues with other districts.

## Troubleshooting

| Code                             | Meaning                                                         |
| -------------------------------- | --------------------------------------------------------------- |
| `OSM_SNAPSHOT_NOT_FOUND`         | The source lock points to a missing cached PBF.                 |
| `OSM_SNAPSHOT_CHECKSUM_MISMATCH` | Cached bytes do not match the source-lock SHA-256.              |
| `OSM_SNAPSHOT_PARSE_FAILED`      | The PBF could not be parsed.                                    |
| `OSM_BARRIER_ARTIFACT_INVALID`   | A manifest, quality file, GeoJSON layer, or seed file is wrong. |
| `OSM_BARRIER_INPUT_INSUFFICIENT` | The ADM2 barrier package is too sparse for smart generation.    |

Production builds must fix the cache/source-lock mismatch or return explicit failure. They
should not query live Overpass as a hidden recovery path.

## License

Barrier artifacts and smart-derived outputs that use OSM barriers carry OpenStreetMap attribution
and ODbL metadata through the source-lock, barrier manifest, smart fallback source metadata, and
hybrid provenance chain. Review ODbL obligations before distributing derived artifacts.

Artifacts are written to a temporary directory and renamed after all layers complete. Province
checkpoints are local, and resume parsing uses the full original province window so warning
context and barrier checksums remain stable. See [Sprint 6](./turkey-sprint-6-nationwide.md).
