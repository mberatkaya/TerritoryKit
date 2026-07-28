# Post-1.1 Master Roadmap

Audit date: 2026-07-28  
Source audit: `docs/audits/production-gap-audit.md`

The requested sequence is directionally correct, but the audit found one
precondition that should come first: release truth. The repository can pack and
validate packages locally, yet npm still exposes only six packages at `1.0.0`
and misses the newer public packages. That mismatch should be resolved before
new production claims are added.

## Corrected Sequence

| Sprint | Theme                                                            | Status         | Why this order                                                                                                                      | Exit criteria                                                                                               |
| ------ | ---------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| S0     | Release truth, docs reconciliation, and dev supply-chain cleanup | partial        | Downstream registry/demo/adapters should not depend on unpublished or mismatched package claims.                                    | npm, README, publishing docs, tags, changesets, and security audit posture agree.                           |
| S1     | Hosted registry and artifact publishing                          | missing        | Production dataset loading needs a stable registry endpoint and immutable artifact channel before demos or adapters can rely on it. | CI publishes approved artifacts, checksums, and an immutable registry plus promoted `latest`.               |
| S2     | Turkey ADM3 ingestion infrastructure                             | partial        | The Gaziantep pilot proves the path but not the nationwide, multi-source, production-quality workflow.                              | Multi-source ADM3 ingestion produces deterministic reports and refuses publish for blocking quality issues. |
| S3     | Turkey ADM3 source expansion                                     | blocked        | Nationwide mahalle coverage depends on approved source availability and licenses, not just code.                                    | Each accepted source has lock metadata, license proof, attribution, expected coverage, and quality status.  |
| S4     | Leaflet and OpenLayers adapters                                  | future roadmap | Web adapters should share the stabilized runtime/adapter contracts and hosted artifacts.                                            | Both adapters render registry-loaded datasets and pass shared lifecycle tests.                              |
| S5     | React Native adapter and mobile/offline loading                  | future roadmap | Mobile needs the hosted registry plus platform-specific cache/storage rules.                                                        | React Native path verifies, caches, and renders a registry dataset offline.                                 |
| S6     | Dataset diff and migration tools                                 | future roadmap | Stable ID continuity becomes critical once production artifacts begin moving between versions.                                      | CLI emits coverage, geometry, parent, and stable-ID diffs between registry releases.                        |
| S7     | Hosted live Turkey demo                                          | partial        | The demo should point at real hosted artifacts, not local environment-only registry paths.                                          | Public demo renders Turkey artifacts from the production registry and passes visual smoke tests.            |
| S8     | Game package                                                     | future roadmap | Game APIs should consume stable public data/runtime APIs rather than shaping them prematurely.                                      | Game package ships without breaking core/runtime/dataset contracts.                                         |
| S9     | Production hardening, release, and rollback                      | partial        | Hardening spans the whole pipeline after registry, artifacts, adapters, and migration checks exist.                                 | Release checklist includes rollback drill, CI duration budgets, security audit, and production monitoring.  |

## Sprint Details

### S0: Release Truth and Supply Chain

Scope:

- Reconcile README, npm publishing docs, roadmap docs, and package manifests.
- Publish or intentionally defer all public workspace packages.
- Resolve or document dev dependency audit findings.
- Ensure changesets and tags describe the real release line.

Acceptance:

- `npm view` results match the documented package matrix.
- `pnpm package:dry-run` and `pnpm release:check` pass.
- `pnpm audit --audit-level moderate` passes or approved exceptions are recorded.
- No documentation says production-ready where only local/package-dry-run evidence
  exists.

### S1: Hosted Registry and Artifact Publishing

Scope:

- Add immutable artifact object layout.
- Add registry promotion from immutable version to `latest`.
- Add checksum and size validation at publish time.
- Add a provider registry entry for every built-in production source adapter or a
  documented exclusion.

Acceptance:

- A public registry URL resolves a schema-valid manifest.
- Artifacts referenced by the registry download and verify by checksum.
- Rollback to a previous manifest is possible without mutating old artifacts.
- Data packages remain loader/metadata packages and do not embed large geometry.

### S2: Turkey ADM3 Ingestion Infrastructure

Scope:

- Generalize the Gaziantep pilot flow for multiple ADM3 sources.
- Normalize source manifests, parent mapping, ID generation, and conflict reports.
- Gate publish-ready status on production geometry quality results.

Acceptance:

- The ADM3 build accepts more than one approved source manifest.
- Output is deterministic from source locks.
- Quality reports classify blocking and non-blocking issues.
- Non-production pilots cannot be promoted as production datasets.

### S3: Turkey ADM3 Source Expansion

Scope:

- Research authoritative or municipal ADM3 polygon sources.
- Verify redistribution, commercial use, modification, attribution, and expected
  coverage.
- Build a source priority and gap register for nationwide mahalle coverage.

Acceptance:

- Every included source has expected SHA-256, license, attribution, retrieval
  date, and source version metadata.
- Coverage gaps are explicit and approved.
- No source is marked production-ready before legal/source review.

### S4: Leaflet and OpenLayers

Scope:

- Create adapter packages using `adapter-core` and `runtime`.
- Add shared adapter lifecycle contract tests.
- Add examples that load hosted registry datasets.

Acceptance:

- Leaflet and OpenLayers render the same sample territory set as MapLibre.
- Adapters do not duplicate dataset loading logic.
- Public APIs are documented and package dry-runs pass.

### S5: React Native and Mobile Offline

Scope:

- Define mobile cache/storage abstraction.
- Integrate registry download/verify/update for offline use.
- Add at least one React Native map provider path.

Acceptance:

- Mobile example installs a dataset, verifies checksums, restarts offline, and
  renders cached territories.
- Cache eviction and stale manifest behavior are documented.

### S6: Dataset Diff and Migration

Scope:

- Compare two dataset artifacts or registry versions.
- Report zone additions/removals, parent changes, geometry changes, adjacency
  changes, and stable-ID churn.
- Emit migration metadata for consumers.

Acceptance:

- CLI fails releases on undocumented stable-ID breaking changes.
- Migration reports are linked from registry manifests.

### S7: Hosted Turkey Demo

Scope:

- Deploy the existing Turkey MapLibre example against the production registry.
- Add visual smoke checks for production artifacts.
- Document public demo ownership and update process.

Acceptance:

- Public URL renders Turkey data without local environment variables.
- CI catches blank map, missing tiles, and registry download failures.

### S8: Game Package

Scope:

- Add game-facing helpers only after runtime/dataset APIs are stable.
- Keep game state separate from core geospatial logic.

Acceptance:

- Game package consumes existing public APIs.
- No core package breaking changes are required.

### S9: Production Hardening and Release

Scope:

- Add rollback drill, incident checklist, CI timing reports, artifact budget trend
  reports, and monitoring hooks.
- Harden release governance around hosted datasets.

Acceptance:

- A production release can be promoted, verified, rolled back, and audited from
  repository records.
