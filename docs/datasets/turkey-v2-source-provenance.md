# Turkey V2 Source Class And Provenance

Turkey V2 ADM3 zones declare `sourceClass`:

1. `official`
2. `osm`
3. `generated`

Priority is `official > osm > generated`. The hybrid builder applies that priority for
representative district and batch artifacts. Final national 81-province publication remains a
future build/release step.

`sourceClass` is the final zone semantics and must be `official`, `osm`, or `generated`.
`providerClass` is separate and can describe access policy such as `runtime` or `experimental`.
Runtime official sources still produce final `sourceClass: "official"` zones; experimental sources
remain opt-in.

ADM3 zones also declare `boundaryKind`, `boundarySourceClass`, `confidence`, `administrative`, and
`licenseState`. These are the canonical publication fields; `sourceClass` alone is not enough to
decide whether a polygon is an official administrative boundary.

| `boundarySourceClass` | `boundaryKind`   | `administrative` | Default confidence | Publication meaning                              |
| --------------------- | ---------------- | ---------------- | ------------------ | ------------------------------------------------ |
| `official-national`   | `administrative` | `true`           | `authoritative`    | Approved national government/open-data source.   |
| `official-local`      | `administrative` | `true`           | `authoritative`    | Approved municipality/province/local source.     |
| `osm-administrative`  | `administrative` | `false`          | `high`             | OSM admin boundary, not an official source.      |
| `smart-derived`       | `estimated`      | `false`          | `medium`           | Algorithmic playable coverage, never official.   |
| `synthetic-test`      | `estimated`      | `false`          | `low`              | Test/demo fixture, never publishable production. |

`confidence: "authoritative"` is only valid for approved official source classes with
`licenseState: "approved"`. A source whose license or redistribution status is still under review
must use `licenseState: "pending"` or `"restricted"` and cannot produce authoritative published ADM3
boundaries.

## Official

Official records come from government bodies or open municipal portals with reviewed license and
attribution metadata.

Required strict metadata:

- `official: true`
- `generated: false`
- `boundaryKind: "administrative"`
- `boundarySourceClass: "official-national"` or `"official-local"`
- `confidence: "authoritative"`
- `administrative: true`
- `licenseState: "approved"`
- provider/source reference
- source-native ID when available
- source date
- source snapshot checksum
- geometry hash
- license
- attribution
- `semanticType` of `neighbourhood` or `village`

## OSM

OSM records must be verified closed polygon/relation administrative boundaries. Place nodes, open
ways, and broken relations are not promoted to ADM3 polygons.

Required strict metadata:

- `official: false`
- `generated: false`
- `boundaryKind: "administrative"`
- `boundarySourceClass: "osm-administrative"`
- `confidence: "high"` unless downgraded by review
- `administrative: false`
- `licenseState: "approved"` for the checked OSM snapshot
- OSM source-native ID such as `relation-987654`
- ODbL license and OpenStreetMap attribution
- source snapshot checksum
- geometry hash
- source URL or repository provenance reference
- `semanticType` of `neighbourhood`, `village`, or reviewed administrative unit

## Generated

Generated records are TerritoryKit game zones used where no reviewed real ADM3 polygon exists.

Required strict metadata:

- `official: false`
- `generated: true`
- `boundaryKind: "estimated"`
- `boundarySourceClass: "smart-derived"`
- `confidence: "medium"`
- `administrative: false`
- `licenseState: "approved"` for the generator configuration
- `semanticType: "generated-zone"`
- generator `algorithmVersion`
- deterministic seed or local key
- generator configuration checksum as `sourceSnapshotChecksum`
- geometry hash
- Apache-2.0 TerritoryKit generation attribution

Generated records are not official mahalle or köy records and must not be displayed as such.

## Synthetic Test Fixtures

Synthetic fixtures such as `createTurkeyAdm3DemoDataset()` use
`boundarySourceClass: "synthetic-test"`, `boundaryKind: "estimated"`, `confidence: "low"`, and
`administrative: false`. They are valid for tests that explicitly allow fixtures, but the Turkey V2
production validation path rejects them with `SYNTHETIC_SOURCE_NOT_PUBLISHABLE`.

## Example

```json
{
  "sourceClass": "official",
  "boundaryKind": "administrative",
  "boundarySourceClass": "official-local",
  "confidence": "authoritative",
  "administrative": true,
  "providerId": "gaziantep-open-data",
  "sourceId": "100001",
  "sourceDate": "2026-02-18T13:52:03Z",
  "sourceVersion": "fixture",
  "sourceSnapshotChecksum": "f145ae9edd2db7a341634e14d59060a535258461794d361c3f49bdec2bcbfa9a",
  "licenseState": "approved",
  "geometryHash": "sha256:...",
  "license": "CC BY 4.0",
  "attribution": "Gaziantep Büyükşehir Belediyesi, Mahalle Sınır Alanları, CC BY 4.0"
}
```
