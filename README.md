# TerritoryKit

Sprint 7 adds a [versioned Turkey delivery contract](./docs/datasets/turkey-sprint-7-delivery.md) for scoped shards, MVT, source changes, attribution, and explicit estimated-boundary resolution. The Sprint 6 dataset candidate remains `2.1.0-rc.7`; npm packages remain `2.1.0` pending review and the normal Changesets release process.

## Sprint 6 final candidate: `2.1.0-rc.7`

The publish-ready local candidate uses `smart-derived-v1.7`. All 39 Istanbul districts and all
973 national districts have usable ADM3 output, with zero hard rejects and zero production legacy
grids. National renderable coverage is 99.999979%; approved official polygons cover 4.997459% of
area, and generated Smart output covers the remaining 95.002520%. The final ADM3 artifact has
3,343 official and 17,049 generated zones; no verified OSM administrative source was present in
this source lock. District Smart confidence is high 306, medium 36, low 631. Low confidence means
estimated, non-administrative geography with recorded limitations; it does not turn a boundary
into an official mahalle record. The [final nationwide report](./reports/baselines/sprint-6-national-rc7.json),
[Istanbul QA](./reports/baselines/sprint-6-istanbul-39-rc7.json), and
[official preservation audit](./reports/baselines/sprint-6-official-preservation-rc7.json)
record the measured evidence. The historical `2.0.0` artifact and npm packages remain unchanged.

[npm Profile: mberat](https://www.npmjs.com/~mberat) ·
[Core](https://www.npmjs.com/package/@territory-kit/core) ·
[CLI](https://www.npmjs.com/package/@territory-kit/cli) ·
[Generators](https://www.npmjs.com/package/@territory-kit/generators)

TerritoryKit is a TypeScript-first geospatial SDK for hierarchical, irregular polygon
territories. It aims for an H3-like developer experience while keeping the core engine
independent from map renderers, backend frameworks, and game-specific state.

## Current Release

TerritoryKit `2.1.0` is the current npm sync release for the V2 line. Public package manifests for
the fixed core family are versioned at `2.1.0` after the Changesets Version Packages step; the root
workspace stays private and its `0.0.0-private` version is tooling metadata, not a public product
version.

The historical Turkey V2 national playable dataset contract is
`territory-kit-tr-v2-playable@2.0.0`. It provides 1 ADM0 country, 81 ADM1 provinces, 973 ADM2
districts, and nationwide playable ADM3 coverage through resolver-managed external artifacts.

## Package Maturity

- Stable core line: `@territory-kit/dataset`, `@territory-kit/core`, `@territory-kit/registry`,
  `@territory-kit/adapter-core`, `@territory-kit/runtime`, `@territory-kit/generators`,
  `@territory-kit/cli`, and `@territory-kit/game`.
- Renderer and integration packages: `@territory-kit/maplibre`, `@territory-kit/leaflet`,
  `@territory-kit/openlayers`, `@territory-kit/react-native`, and `@territory-kit/nestjs`.
- Country loader packages are thin resolver descriptors. Large national geometry is kept outside
  npm packages and loaded through local artifacts or registries.

## Historical Sprint Track

The table below is historical roadmap context, not a claim that every future adapter exists today:

| Product version | Sprint range | Status                         |
| --------------- | ------------ | ------------------------------ |
| `0.0.1`         | Sprint 0     | Complete                       |
| `0.1.0-alpha.1` | Sprint 1     | Hardened on roadmap branch     |
| `0.1.0`         | Sprint 2     | Hardened on roadmap branch     |
| `0.2.0-alpha.1` | Sprint 3     | Hardened on roadmap branch     |
| `0.2.0`         | Sprint 4     | Hardened on roadmap branch     |
| `0.3.0`         | Sprint 5     | Hardened on roadmap branch     |
| `0.4.0`         | Sprint 6     | Hardened on roadmap branch     |
| `0.5.0`         | Sprint 7     | Hardened on roadmap branch     |
| `0.6.0`         | Sprint 8     | Hardened on roadmap branch     |
| `0.9.0-rc.1`    | Sprint 9     | Verified on roadmap branch     |
| `1.0.0`         | Sprint 10    | Prepared on release branch     |
| `1.2.0`         | Sprint 11    | Runtime and adapter boundaries |
| `1.2.0`         | Sprint 12    | Runtime viewport lifecycle     |
| `1.2.0`         | Sprint 13    | Catalog and binary indexes     |

## Packages

- `@territory-kit/dataset`: dataset manifest, schema, validation, and loading.
- `@territory-kit/adapter-core`: renderer-independent adapter contracts and capability helpers.
- `@territory-kit/core`: engine APIs, spatial lookup, hierarchy, adjacency, viewport queries, and
  binary spatial indexes.
- `@territory-kit/registry`: registry discovery, artifact resolution, verified cache, and Node
  download helpers.
- `@territory-kit/runtime`: viewport request orchestration across catalog datasets, core engines,
  engine pool, runtime cache, worker loading, cancellation, scheduler, and renderer-independent
  adapters.
- `@territory-kit/game`: optional territory ownership, team, action validation, cooldown,
  snapshot, idempotency, event, audit, and repository contracts for game domains.
- `@territory-kit/maplibre`: first map adapter boundary for MapLibre GL JS.
- `@territory-kit/leaflet`: Leaflet adapter with native GeoJSON layers and optional plugin-backed
  vector tile hooks.
- `@territory-kit/openlayers`: OpenLayers adapter with `VectorSource`, `VectorLayer`, feature
  picking, projection checks, and optional vector tile hooks.
- `@territory-kit/nestjs`: NestJS integration boundary and PostGIS repository contracts.
- `@territory-kit/generators`: deterministic dataset helper, source, and adjacency utilities.
- `@territory-kit/cli`: `territory validate`, `territory geometry`, `territory index`, binary
  index artifact tools, and adjacency artifact tools.
- `@territory-kit/data-tr`, `@territory-kit/data-us`, `@territory-kit/data-de`,
  `@territory-kit/data-jp`, `@territory-kit/data-id`: thin resolver-driven pilot country loaders
  without embedded geometry artifacts.
- `@territory-kit/shared-testkit`: private fixtures for tests and examples.

## Migration And Deprecation

New code should import registry APIs from `@territory-kit/registry`. Core still exposes registry
exports for compatibility, but they are deprecated and mirrored under
`@territory-kit/core/legacy-registry` for migration work. Runtime orchestration is additive and
does not replace existing core engine or MapLibre APIs.

## Global Dataset Builds

The global dataset pipeline starts with source adapters and a local Natural Earth ADM0 builder:

```bash
territory dataset build world-countries \
  --source ./sources/ne-admin0.geojson \
  --output ./dist/world-countries
```

```bash
territory source list
territory sources inspect --provider geoboundaries --country TR --level ADM3 --json
territory dataset coverage
territory import geojson --input ./regions.geojson --output ./dist/regions --country TR --admin-level ADM2 --name-property name
territory geometry validate ./dist/regions --checks full --report ./geometry-report.json
territory adjacency build ./dist/regions --output ./dist/regions-adjacency
territory country source lock TR --output ./dist/tr/sources.lock.json
territory country build TR --source-lock ./dist/tr/sources.lock.json --output ./dist/tr --build-adjacency --strict
territory country build TR --source-lock ./dist/tr/sources.lock.json --output ./dist/tr --levels ADM0,ADM1,ADM2,ADM3,ADM4 --build-adjacency --build-query-artifacts --build-render-artifacts --build-binary-index --strict --allow-partial
territory tr osm acquire --dry-run
territory tr osm acquire --cache .territory/cache
territory tr osm verify --source-lock .territory/cache/osm/TR/<snapshot-id>/source-lock.json
territory tr osm barriers build --adm2 .territory/build/TR/V2-national/levels/ADM2/dataset.json --source-lock .territory/cache/osm/TR/<snapshot-id>/source-lock.json --offline --output .territory/build/TR/OSM-barriers --concurrency 2
territory tr osm barriers inspect --barriers .territory/build/TR/OSM-barriers --adm2 tr:adm2:example
territory tr osm smart coverage --adm2 .territory/build/TR/V2-national/levels/ADM2/dataset.json --barriers .territory/build/TR/OSM-barriers --output reports/tr-adm3/osm-smart-coverage.json
territory tr adm3 hybrid build --district .territory/build/TR/V2-national/levels/ADM2/dataset.json --district-id tr:adm2:example --osm-barrier-artifact .territory/build/TR/OSM-barriers/ADM2/tr_adm2_example --output .territory/build/TR/ADM3-smart-example --force
territory geometry simplify ./dist/tr/levels/ADM2/dataset.json --strategy topology-safe --detail high,medium,low --output ./dist/tr/levels/ADM2/simplified --report ./dist/tr/levels/ADM2/simplification-report.json
territory registry build --input ./dist --output ./dist/registry.json --base-url https://cdn.example.test/datasets/
territory dataset install territory-kit-tr --registry ./dist/registry.json --levels ADM0,ADM1 --load-adjacency
```

Generated world-country artifacts are documented in
[docs/datasets/world-countries.md](./docs/datasets/world-countries.md) and are not embedded in npm
packages. Pilot country artifacts are documented in
[docs/country-datasets.md](./docs/country-datasets.md); their loader packages also do not embed
geometry.

The generated coverage registry lives in `datasets/registry/coverage.json` and is summarized in
[docs/datasets/coverage.md](./docs/datasets/coverage.md). TerritoryKit supports lower
administrative levels when a suitable source exists, but it does not guarantee neighbourhood-level
coverage for every country. Municipality and neighbourhood are semantic types on ADM records, not
pseudo-administrative levels. Turkey has a reviewed HDX/OCHA COD-AB source path for national
ADM0-ADM2. The Turkey V2 national playable artifact adds nationwide ADM3 gameplay coverage by
using reviewed real boundaries where available and deterministic generated fallback elsewhere.
Generated fallback zones remain non-official `generated-zone` records, not official mahalle/koy
administrative boundaries. ADM4 remains source-model blocked. See
[docs/datasets/turkey-national-coverage.md](./docs/datasets/turkey-national-coverage.md),
[docs/datasets/turkey-sources.md](./docs/datasets/turkey-sources.md), and the partial Gaziantep
ADM3 pilot in
[docs/datasets/turkey-neighbourhoods.md](./docs/datasets/turkey-neighbourhoods.md).
The Turkey ADM3 resolver priority is official ADM3, then OSM administrative ADM3, then a locked
real OSM barrier snapshot feeding standard Smart, then organic low-confidence Smart.
Legacy axis-aligned generation is disabled in normal national production. Unsafe Smart output
returns an explicit failure. Smart-derived results remain non-official estimated
gameplay coverage with `boundaryKind: "estimated"`, `boundarySourceClass: "smart-derived"`,
`administrative: false`, and `authoritative: false`. Production smart builds use checksum-locked
OSM snapshots and offline rebuilds instead of live Overpass queries. See
[docs/datasets/turkey-smart-fallback.md](./docs/datasets/turkey-smart-fallback.md) and
[docs/datasets/turkey-osm-barrier-snapshots.md](./docs/datasets/turkey-osm-barrier-snapshots.md).
Sprint 5.1 final hardening verifies that path against a real locked Fatih artifact: smart fallback selects
47 smart-derived zones for Fatih with `coverage=99.999505`, `outsideSpill=0`,
`meanBarrierAlignment=0.286977`, and `meanQuality=0.625907`. Hybrid quality reports expose
`smartAttempt` so accepted Smart output and explicit rejection decisions are auditable.
The accepted Sprint 6 `2.1.0-rc.1` baseline contains: 973/973 districts,
34,253 ADM3 zones, zero production legacy grids, and verified province/district shards. The
historical `2.0.0` artifact is retained; this candidate is not an npm publication or automatic upgrade.
Organic Smart geographic calibration treats Voronoi cells as coarse ownership, then routes shared
boundaries along real OSM road, rail and water corridors under unchanged topology gates. These
remain geography-aware estimated gameplay boundaries. Quality reports measure barrier-following
length and long unsupported straight chains at every angle.

The recalibrated `2.1.0-rc.2` candidate has a separate artifact identity and requires an
explicit version selection and migration review.
See [Sprint 6 nationwide Smart coverage](./docs/datasets/turkey-sprint-6-nationwide.md).
Turkey V2 defines the additive data contract for mixing official, OSM, and generated ADM3 game
zones without presenting generated zones as official mahalle/koy records. The stable national
builder applies official, OSM administrative, standard Smart, then organic Smart priority, emits
registry/checksum/source-lock evidence, and keeps the national geometry external to npm packages.
See
[docs/datasets/turkey-v2-data-contract.md](./docs/datasets/turkey-v2-data-contract.md),
[docs/datasets/turkey-v2-source-provenance.md](./docs/datasets/turkey-v2-source-provenance.md),
[docs/datasets/turkey-v2-hybrid-coverage.md](./docs/datasets/turkey-v2-hybrid-coverage.md),
[docs/datasets/turkey-v2-national-playable.md](./docs/datasets/turkey-v2-national-playable.md),
[docs/datasets/turkey-v2-migration.md](./docs/datasets/turkey-v2-migration.md), and
[ADR-007](./adr/ADR-007-turkey-v2-stable-identity.md) / [ADR-009](./adr/ADR-009-turkey-v2-hybrid-source-priority.md).
The current product gap analysis is tracked in
[docs/product-gap-analysis.md](./docs/product-gap-analysis.md).

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
pnpm lint
pnpm bundle:size
pnpm release:check
```

Node.js `>=22` and pnpm `>=11` are required. The current TypeScript baseline is `6.0.3`;
TypeScript 7 will be evaluated in a later ADR before adoption.

## 2.0 Release Handoff

The `2.0.0` handoff keeps `territory-schema@1` unchanged and promotes the Turkey V2 national
playable dataset from RC metadata to stable `2.0.0`. The release-hardening and Changesets Version
Packages PRs have prepared release notes, benchmark evidence, package dry-runs, release-hardening
evidence, package versions, and package changelogs. Publishing and tagging remain maintainer
actions after workflow verification.

## Planning Docs

- [Product requirements](./docs/prd.md)
- [H3 comparison](./docs/h3-comparison.md)
- [Risk register](./docs/risk-register.md)
- [Release governance](./docs/release-governance.md)
- [Turkey national source ADR](./adr/ADR-006-turkey-national-administrative-sources.md)
- [Turkey V2 stable identity ADR](./adr/ADR-007-turkey-v2-stable-identity.md)
- [Roadmap](./docs/roadmap.md)
- [Release check](./docs/release-check.md)
- [Runtime architecture audit](./docs/architecture/runtime-architecture-audit.md)
- [Runtime contract](./docs/architecture/runtime-contract.md)
- [Runtime viewport audit](./docs/architecture/runtime-viewport-audit.md)
- [Runtime viewport lifecycle](./docs/architecture/runtime-viewport-lifecycle.md)
- [Runtime cache](./docs/runtime-cache.md)
- [Multi-dataset catalog](./docs/catalog.md)
- [Binary spatial index](./docs/binary-spatial-index.md)
- [Worker loading](./docs/worker-loading.md)
- [Game territory engine](./docs/game/overview.md)
- [Game domain model](./docs/game/domain-model.md)
- [Game persistence](./docs/game/persistence.md)
- [Game concurrency](./docs/game/concurrency.md)
- [Game dataset migrations](./docs/game/dataset-migrations.md)
- [Adapter contract](./docs/architecture/adapter-contract.md)
- [Core/registry boundary](./docs/architecture/core-registry-boundary.md)
- [Errors](./docs/errors.md)
- [Product gap analysis](./docs/product-gap-analysis.md)
- [Dataset compatibility](./docs/dataset-compatibility.md)
- [Source adapters](./docs/source-adapters.md)
- [Source pipeline](./docs/source-pipeline.md)
- [Source cache](./docs/source-cache.md)
- [Country datasets](./docs/country-datasets.md)
- [Country source locks](./docs/country-source-locks.md)
- [Country loaders](./docs/country-loaders.md)
- [Dataset registry](./docs/dataset-registry.md)
- [Dataset installation](./docs/dataset-installation.md)
- [Dataset cache](./docs/dataset-cache.md)
- [Registry hosting](./docs/registry-hosting.md)
- [Offline datasets](./docs/offline-datasets.md)
- [Dataset versioning](./docs/dataset-versioning.md)
- [Query artifacts](./docs/query-artifacts.md)
- [Render artifacts](./docs/render-artifacts.md)
- [Vector tile pipeline](./docs/vector-tile-pipeline.md)
- [MapLibre registry integration](./docs/maplibre-registry-integration.md)
- [Leaflet integration](./docs/leaflet-integration.md)
- [OpenLayers integration](./docs/openlayers-integration.md)
- [Renderer adapter comparison](./docs/renderer-adapter-comparison.md)
- [Turkey MapLibre example](./docs/examples/turkey-maplibre.md)
- [Turkey Leaflet example](./docs/examples/turkey-leaflet.md)
- [Turkey OpenLayers example](./docs/examples/turkey-openlayers.md)
- [Turkey neighbourhood MapLibre example](./docs/examples/turkey-neighbourhood-maplibre.md)
- [Render/query compatibility](./docs/render-query-compatibility.md)
- [Mobile map loading](./docs/mobile-map-loading.md)
- [Adjacency artifacts](./docs/adjacency.md)
- [Geometry quality](./docs/geometry-quality.md)
- [Geometry validation](./docs/geometry-validation.md)
- [Geometry repair](./docs/geometry-repair.md)
- [Geometry backends](./docs/geometry-backends.md)
- [World countries ADM0 dataset](./docs/datasets/world-countries.md)
- [Global dataset overview](./docs/datasets/global-overview.md)
- [Dataset coverage](./docs/datasets/coverage.md)
- [Lower administrative levels](./docs/datasets/lower-admin-levels.md)
- [Administrative semantics](./docs/datasets/admin-semantics.md)
- [Partial coverage](./docs/datasets/partial-coverage.md)
- [Turkey administrative model](./docs/datasets/turkey-administrative-model.md)
- [Turkey national coverage](./docs/datasets/turkey-national-coverage.md)
- [Turkey sources](./docs/datasets/turkey-sources.md)
- [Turkey build](./docs/datasets/turkey-build.md)
- [Turkey V2 data contract](./docs/datasets/turkey-v2-data-contract.md)
- [Turkey V2 source provenance](./docs/datasets/turkey-v2-source-provenance.md)
- [Turkey V2 hybrid coverage](./docs/datasets/turkey-v2-hybrid-coverage.md)
- [Turkey V2 migration](./docs/datasets/turkey-v2-migration.md)
- [Turkey smart fallback](./docs/datasets/turkey-smart-fallback.md)
- [Turkey OSM barrier snapshots](./docs/datasets/turkey-osm-barrier-snapshots.md)
- [Turkey licensing](./docs/datasets/turkey-licensing.md)
- [Turkey neighbourhoods](./docs/datasets/turkey-neighbourhoods.md)
- [Dataset providers](./docs/datasets/providers.md)
- [Lower-admin providers](./docs/sources/lower-admin-providers.md)
- [Gaziantep ADM3 source](./docs/sources/gaziantep-open-data.md)
- [Benchmarks](./docs/benchmarks.md)
- [Real-world benchmarks](./docs/real-world-benchmarks.md)
- [NestJS and PostGIS](./docs/nestjs-postgis.md)
- [Release readiness](./docs/release-readiness.md)
- [Master sprint checklist](./docs/sprint-checklist.md)

The historical `2.1.0-rc.2` calibration candidate is **not publish-ready**: 949/973 districts pass,
24 fail and seven are unavailable. Two precision exceptions omit 58 approved polygons.
See [the complete calibration evidence](reports/baselines/sprint-6-geographic-calibration.json).

## Historical Sprint 6 rc.3 evaluation

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
[Istanbul acceptance report](reports/baselines/sprint-6-istanbul-39-rc3.json) records each
district's build and QA status. All 39 maps were reviewed: 11 pass, five pass with
low-confidence limitations, and 23 fail (including four machine-accepted outputs with visible
ruler seams). Istanbul blocks the full rc.3 national publish-ready run, so this candidate is
**DO NOT MERGE**. See the [24-district retest](reports/baselines/sprint-6-final-recovery.json)
(8 accepted, 16 rejected) and [national rc.3 status](reports/baselines/sprint-6-final-national.json).
The bounded rc.3 five-district national smoke also fails the district quality and coverage gates.
The historical rc.1 and rc.2 evidence above is retained separately.
