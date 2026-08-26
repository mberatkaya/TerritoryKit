# ADR 0013: Turkey ADM3 Province-Scoped Ingestion

## Status

Accepted.

## Context

Turkey has verified national ADM0-ADM2 sources, but ADM3 neighbourhood coverage is fragmented
across province and municipal providers. Treating ADM3 as a single national source would either
block useful partial coverage or accidentally imply nationwide completeness.

## Decision

TerritoryKit will ingest Turkey ADM3 through `extensions.turkeyAdm3` in the country source lock.
Each province source has its own catalog entry, adapter contract, license metadata, checksum, byte
size, parent mapping, coverage state, and provenance. The regular country builder still produces
normal TerritoryKit artifacts, but ADM3 source acquisition and parsing are province-scoped.

Partial builds require explicit `--allow-partial`. Missing provinces are represented as ADM2
fallback coverage, never as completed ADM3 coverage.

ADM3 locks and artifacts must also preserve canonical boundary governance metadata:
`boundarySourceClass`, `boundaryKind`, `confidence`, `administrative`, `licenseState`,
`sourceSnapshotChecksum`, provider/source IDs, attribution, source date when known, and geometry
hash. Synthetic test fixtures and smart-derived playable geometry are not official ADM3 and cannot
be published by the production Turkey V2 validation path.

## Consequences

- New province sources can be added through catalog entries rather than core builder rewrites.
- One failed province can be isolated from already verified provinces.
- Generic HTTP/CDN artifact publishing can consume the resulting normal country artifact.
- A future nationwide ADM3 source can still be represented either as a catalog entry covering every
  province or as a separate reviewed source-lock extension.
