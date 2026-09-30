# Turkey V2 delivery contract (Sprint 7)

The national `territory-kit-tr-v2-playable@2.1.0-rc.7` artifact is a dataset candidate. Its version is independent of the npm package release. The current public fixed package family is `2.1.0`; the pending additive Changeset targets `2.2.0` after review and merge. This sprint does not promote the dataset candidate or publish npm packages.

## Delivery tiers

| Need                    | Artifact                                                                                         | Loading rule                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Full canonical geometry | `levels/ADM3/dataset.json`, `levels/ADM3/full.geojson`                                           | Archival and precise analysis only; never mobile startup             |
| Province                | `provinces/<code>/dataset.json`                                                                  | Load selected province                                               |
| District                | `districts/<sanitized-adm2-id>/dataset.json`                                                     | Load selected district                                               |
| Viewport                | `query/query-artifact.json` or the existing catalog/runtime viewport resolver over scoped shards | Keep data scoped; national query artifact is an offline/server index |
| Map                     | `render/tiles/{z}/{x}/{y}.mvt`                                                                   | Normal pan/zoom path                                                 |

The MVT layer is `territory-adm3`, zoom 10–12, extent 4096, buffer 64, tolerance 3. Tiles are derived from full ADM3 geometry. Tile clipping and simplification do not alter canonical zone coordinates or `geometryHash`. Flat feature properties include `territoryId`, `parentId`, `parentAdm2Id`, `datasetVersion`, `sourceClass`, `boundarySourceClass`, `boundaryKind`, `confidence`, `administrative`, `authoritative`, `sourceVersion`, `generatorVersion`, `geometryHash`, `license`, and `sourceAttribution` where available. Existing tiles from Sprint 6 need regeneration before the newly added fields appear in a hosted tile set.

Run `territory tr v2 national delivery-manifest --artifact-root <validated-artifact-root> --output <path>` after the canonical build. It combines the existing checksum and shard inventories into `territorykit-tr-v2-delivery@1`. The manifest contains the canonical geometry hash, source lock hash, MVT policy and checksum-index hash, attribution/adjacency/query/migration checksums, and every province/district shard checksum. It is deterministic for fixed inputs; `buildDate` is a pinned input, not the cache key. Individual tile checksums remain in `checksums.json`.

Use `@territory-kit/runtime/turkey-v2-delivery` `resolveTurkeyV2Boundaries({ manifest, adm2Id, allowEstimated, loadShard })` for a district. `loadShard` returns the raw shard bytes; the resolver validates the manifest self-hash for schema v1, checks shard byteSize and SHA-256 before parsing, then checks dataset version, parent ADM2 and boundary semantics. Estimated output requires `allowEstimated: true`. Results include source composition, per-zone source/confidence/administrative metadata, dataset version, artifact path, and a manifest-and-checksum-based cache identity. `getTurkeyV2Attribution` selects required notices from `attribution.json`; `getTurkeyV2Neighbors` reads the canonical adjacency edges. The existing `migration-plan.json` supplies replacement evidence. Cache mismatch is detected when the dataset version, canonical geometry hash, manifest content hash, artifact path, or artifact checksum differs.

Web clients use Web Crypto for the shard checksum. React Native clients can pass `sha256: createMobileTerritoryChecksumAdapter().sha256` from `@territory-kit/react-native` to the resolver. This keeps checksum verification active where Web Crypto is unavailable.

`@territory-kit/maplibre` already supports registry MVT sources. A mobile map should request the MVT source first, then fetch district shards on selection. The national full GeoJSON is about 307 MB in the Sprint 6 candidate and is not part of this startup path. The largest recorded candidate tile was 155,465 bytes across 18,856 tiles. Province shards reach about 40 MB; district shards reach about 7.4 MB. These are observed local artifact sizes, not network latency promises.

## Source refresh and audit

Keep OSM snapshots pinned and SHA-256 locked. Review candidates on a quarterly cadence and at release preparation; no timed job promotes them automatically. The workflow is: acquire a new Geofabrik snapshot, verify its source lock, extract barriers offline, run `territory tr v2 national source-diff --previous-lock <old> --candidate-lock <new>`, rebuild affected candidates, compare quality and `migration-plan.json`, then seek release approval. A checksum or URL change needs audit evidence before promotion. The source diff reports added/removed sources, checksum changes, version changes, metadata changes, and affected provinces where a local provider is scoped. A national ADM0–ADM2, OSM, or generator change requires national review. Exact changed geometry and territory IDs require a candidate rebuild plus dataset diff; source locks alone cannot prove them.

Existing `territory tr adm3 providers list`, `providers health`, `source-audit`, and `coverage` commands expose registry readiness, source review, and coverage without duplicating that workflow in the national CLI.

The build already writes canonical adjacency from full geometry and a query artifact. `checksums.json` and strict `validate --publish-ready` verify integrity. The Sprint 6 candidate remains `2.1.0-rc.7` until a separately reviewed dataset promotion confirms identical canonical geometry hashes or documents an intentional change. No npm semver action implicitly promotes a dataset.

## Sprint 8 handoff

Rush&Claim should start with the delivery manifest and MVT template, load only visible tiles, fetch a district shard when precise territory resolution is needed, pass `allowEstimated: true` only for playable generated zones, inspect `boundaryKind` and `confidence`, display attribution from `attribution.json`, use `levels/ADM3/adjacency/adjacency.json` for neighbors, reject stale shard checksums, and apply `migration-plan.json` for old territory IDs. Ownership migration and production rollout are outside this sprint.

See the [release evidence](./turkey-sprint-7-release-evidence.md) and [machine-readable Sprint 8 handoff](../../reports/baselines/sprint-7-delivery-handoff.json).

For authenticity, obtain the manifest from a trusted HTTPS channel and pass `expectedManifestContentHash` from an independently trusted source. The manifest self-hash and artifact SHA-256 prove consistency, not publisher identity. New manifests carry `adm2Shards` so the resolver uses an exact canonical-ID mapping. Legacy manifests are still accepted, but a shard whose parent does not match the requested ADM2 fails closed. Deploy the matching manifest and tiles atomically.
