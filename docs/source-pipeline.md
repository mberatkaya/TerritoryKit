# Source Pipeline

The source pipeline is the shared import orchestrator for provider adapters.

```text
resolve -> fetch -> verify -> parse -> normalize -> transform -> validate -> enrich -> serialize -> complete
```

## Stages

- `resolve`: find the adapter and validate provider options.
- `fetch`: resolve a local file or download a remote artifact through a transport.
- `verify`: check file existence, regular-file status, size, SHA-256, and expected checksum.
- `parse`: parse provider input without transforming semantics.
- `normalize`: optional adapter-local normalization.
- `transform`: create a TerritoryKit dataset and provider metadata.
- `validate`: run existing dataset validation, global manifest validation, and geometry quality
  checks.
- `enrich`: reserve metadata enrichment boundary.
- `serialize`: atomically write artifact files if an output path is supplied.
- `complete`: emit the terminal lifecycle event.

The pipeline emits structured lifecycle events and issues. It does not depend on the CLI and does
not write to the console.

## Geometry Quality

Source imports run `geometryQuality: "basic"` by default. Basic mode checks coordinates, rings, and
bbox metadata. Pass `"full"` to add topology, hierarchy, and sibling overlap checks, or `"none"` to
disable geometry quality for a pipeline run.

Geometry quality issues are mapped into source issues with `GEOMETRY_*` codes. Full reports are
attached to `result.transform.geometryQuality`. Generic build reports include a compact quality
summary; source-owned artifact plans keep their checksummed file output stable.

## Adjacency Build

The CLI can run the polygon adjacency builder immediately after a successful source import:

```sh
territory import geojson --input ./regions.geojson --output ./dist/regions --country TR --admin-level ADM2 --name-property name --build-adjacency
```

This writes a separate `adjacency/` directory under the import output. Use
`--adjacency-include-point-touches`, `--adjacency-minimum-shared-boundary-meters`, and
`--adjacency-overrides` to tune the generated artifact.

## Strict Mode

Warnings are allowed by default. `--strict` converts warnings into `STRICT_*` errors after transform
and validation, before serialization. This prevents partial output.

## Determinism

JSON artifacts use stable key ordering. Build reports normalize elapsed build duration to `0` where
that field is part of reproducible artifacts. Remote fetch metadata such as `ETag` and
`Last-Modified` is preserved when available but not invented.
