# Turkey V2 National Playable Dataset

Turkey V2 national playable artifacts are built by:

```bash
pnpm turkey:v2:national:publish-ready
pnpm turkey:v2:national:validate:publish-ready
```

The stable build target is `territory-kit-tr-v2-playable@2.0.0`. It keeps the canonical Turkey
ADM0-ADM2 hierarchy from HDX/OCHA COD-AB and fills ADM3 gameplay coverage nationwide with the
Turkey V2 hybrid priority:

```text
official > osm > generated
```

Generated fallback zones are playable game zones only. They are never official mahalle, koy, or
administrative records.

## Scope

| Level | Scope                       | Source policy                                |
| ----- | --------------------------- | -------------------------------------------- |
| ADM0  | 1 country                   | HDX/OCHA COD-AB                              |
| ADM1  | 81 provinces                | HDX/OCHA COD-AB                              |
| ADM2  | 973 canonical districts     | HDX/OCHA COD-AB                              |
| ADM3  | playable per-district zones | official/OSM where built, generated fallback |

The local build uses reviewed official ADM3 artifacts when they are present at
`.territory/build/TR/ADM3/official/levels/ADM3/dataset.json`. OSM is reported as `not-built` unless
an OSM artifact is provided with `--osm-artifact`.

## ADM3 Availability Status

`coverage.json` reports ADM3 availability for every built ADM2 district and rolls those statuses up
by province. This is separate from final playable coverage percent:

- `official`: approved official ADM3 geometry covers the district.
- `osm-administrative`: reviewed OSM administrative geometry is selected.
- `estimated`: smart-derived playable geometry fills the district.
- `mixed`: more than one source class contributes after priority clipping.
- `unavailable`: no ADM3 zones were built for that ADM2.
- `failed`: ADM3 geometry exists but did not pass quality gates.

Reason codes are deterministic: `official-source-approved`,
`osm-administrative-source-selected`, `smart-derived-fallback`, `mixed-source-priority`,
`no-adm3-zones-built`, and `quality-gate-failed`. Missing official ADM3 data is represented as
`estimated` or `unavailable` coverage, never as fake official neighbourhood geometry.

## Stable 2.0.0 Verification Snapshot

The 2026-08-22 publish-ready rebuild verified the full stable national contract with:

| Metric                                       |      Value |
| -------------------------------------------- | ---------: |
| ADM0 country records                         |          1 |
| ADM1 provinces                               |         81 |
| ADM2 districts                               |        973 |
| ADM3 playable zones                          |     42,210 |
| official ADM3 zones in final effective layer |      2,094 |
| OSM ADM3 zones                               |          0 |
| generated ADM3 fallback zones                |     40,116 |
| districts at or above 99.99% coverage        |        973 |
| failed districts                             |          0 |
| national final coverage                      | 99.999998% |
| real coverage contribution                   |  3.247194% |
| generated coverage contribution              | 96.752804% |

The rebuilt artifact uses official ADM3 geometry only where reviewed local artifacts are available.
OSM is `not-built` in this snapshot. All remaining ADM3 playable coverage is deterministic generated
fallback and remains marked as generated, non-official `generated-zone` geometry. This is not a claim
that all official Turkish mahalle or koy boundaries are included.

Strict `territory tr v2 national validate --publish-ready` passes against the publish-ready output.
The quality report has `quality.ok = true`, `quality.buildMode = "publish-ready"`, empty
`hardGateFailures`, empty `publishReadyGateFailures`, zero final geometry errors, zero hierarchy
orphan/cycle/duplicate failures, zero effective sibling overlaps, zero real/generated overlaps, zero
parent containment errors, zero missing provenance/license failures, zero adjacency integrity
failures, and zero registry checksum errors.

Topology-safe ADM1 and ADM2 simplification was also verified for high, medium, and low detail tiers.
All tiers have `sharedBoundaryMismatchCount = 0` and `geometryValidation.errorCount = 0`. ADM3 is
distributed through the source/full dataset plus render and adjacency artifacts; the build does not
publish separate ADM3 simplification tiers.

## CLI

```bash
territory tr v2 national plan

territory tr v2 national build \
  --output .territory/build/TR/V2-national \
  --reports-output reports/tr-v2-national \
  --force

territory tr v2 national publish-ready \
  --dataset-version 2.0.0 \
  --build-date 2026-08-22T00:00:00.000Z \
  --output .territory/build/TR/V2-national \
  --reports-output reports/tr-v2-national \
  --force

territory tr v2 national validate \
  --output .territory/build/TR/V2-national

territory tr v2 national validate \
  --output .territory/build/TR/V2-national \
  --publish-ready
```

Useful smoke and benchmark scripts:

```bash
pnpm turkey:v2:national:smoke
pnpm turkey:v2:national:benchmark
```

## Artifacts

The local artifact directory includes:

- `manifest.json`
- `source-lock.json`
- `build-summary.json`
- `coverage.json`
- `quality-report.json`
- `hierarchy-report.json`
- `provenance.json`
- `attribution.json`
- `attribution.txt`
- `licenses.json`
- `distribution-policy.json`
- `migration-plan.json`
- `registry-entry.json`
- `artifact-plan.json`
- `checksums.json`
- `levels/ADM0/dataset.json`
- `levels/ADM1/dataset.json`
- `levels/ADM2/dataset.json`
- `levels/ADM3/dataset.json`
- `levels/ADM3/full.geojson`
- `query/query-artifact.json`
- optional `levels/ADM3/adjacency/adjacency.json`
- optional `render/**` MVT artifacts

Large geometry, render, and binary/query assets are local or registry artifacts. They are not
embedded in `@territory-kit/data-tr`.

Registry entries are emitted only for artifacts that were actually produced and checksummed. When
`--no-render` is used, no render manifest appears in the registry. When `--no-adjacency` is used, no
adjacency artifact appears in the registry. Registry artifacts never use placeholder checksums or
zero byte sizes; every listed artifact must exist, be a regular non-empty file, and match both its
recorded byte size and lowercase 64-character SHA-256 checksum.

## Loader

```ts
import { loadTurkeyV2NationalDataset, resolveTurkeyDataset } from "@territory-kit/data-tr";

const selection = resolveTurkeyDataset({ includePlayableAdm3: true });

const handle = await loadTurkeyV2NationalDataset({
  levels: ["ADM0", "ADM1", "ADM2", "ADM3"],
  registry,
  verifyChecksums: true
});
```

The descriptor is `turkeyV2NationalDatasetDescriptor`. It advertises `ADM0` through `ADM3`, defaults
to `ADM0` through `ADM2`, and requires a resolver or hosted registry.

## Gates

`build` is a diagnostic artifact command. It may write a partial output, including capped
`--max-districts` smoke and benchmark outputs, and those outputs can still have `quality.ok = true`
when the selected subset is internally healthy. Diagnostic output is marked with
`quality.buildMode = "partial"` and `quality.publishReady = false`.

`publish-ready` requires an explicit `--build-date`; the canonical stable script supplies
`2026-08-22T00:00:00.000Z` so release evidence cannot be produced with a hidden stale date.
`publish-ready` and `validate --publish-ready` are strict national gates. They require:

- ADM0 count = 1
- ADM1 count = 81
- ADM2 count = 973
- successful ADM2 count = 973
- failed district count = 0
- source-lock expected and actual ADM0/ADM1/ADM2 counts match the loaded reports
- every ADM2 district built successfully
- every ADM2 district has at least one ADM3 zone
- every district final coverage >= 99.99%
- national final coverage >= 99.99%
- no orphan/cycle/duplicate stable ID failures
- strict Turkey V2 validation passes
- provenance, license, and attribution metadata is present
- registry/checksum metadata is present and every registry artifact matches the filesystem
- adjacency integrity passes when adjacency is built

`publish-ready` exits non-zero when a strict gate fails. `--max-districts`, smoke, and benchmark
outputs are always rejected by strict validation, even when their diagnostic quality checks pass.

`validate` without `--publish-ready` performs general artifact validation: JSON shape, quality
status, registry shape, duplicate artifact id/path checks, path traversal checks, filesystem
presence, byte-size checks, and streaming SHA-256 verification. Broken JSON and unreadable files are
reported as machine-readable issues. `validate --publish-ready` adds the strict national 1/81/973
completeness checks.

Common validation issue codes include `MISSING_ARTIFACT`, `EMPTY_ARTIFACT`, `MISSING_CHECKSUM`,
`INVALID_CHECKSUM_FORMAT`, `CHECKSUM_MISMATCH`, `SIZE_MISMATCH`, `DUPLICATE_ARTIFACT_ID`,
`DUPLICATE_ARTIFACT_PATH`, `UNSAFE_ARTIFACT_PATH`, `CHECKSUM_MANIFEST_MISMATCH`,
`UNEXPECTED_MANDATORY_ARTIFACT_OMISSION`, `NATIONAL_ADM1_COUNT_MISMATCH`,
`NATIONAL_ADM2_COUNT_MISMATCH`, `NATIONAL_SOURCE_LOCK_ACTUAL_COUNT_MISMATCH`, and
`NATIONAL_PARTIAL_BUILD`.
