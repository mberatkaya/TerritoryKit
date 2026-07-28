# Production Roadmap Dependency Graph

Audit date: 2026-07-28

This graph shows the practical dependency order discovered by the production gap
audit. It adds a release-truth precondition before the originally requested
hosted registry work.

```mermaid
flowchart TD
  S0["S0: Release truth and supply-chain cleanup"]
  Registry["S1: Hosted registry"]
  Artifacts["S1: Artifact publishing and CDN"]
  Checksums["Checksum and size verification"]
  Rollback["Registry rollback pointer"]
  TR012["Turkey ADM0-ADM2 source-locked build"]
  ADM3Infra["S2: Turkey ADM3 ingestion infrastructure"]
  ADM3Source["S3: Turkey ADM3 source expansion"]
  Quality["Production geometry quality gates"]
  MVT["MVT tile budgets and performance reports"]
  StableIds["Stable ID continuity"]
  DiffMigration["S6: Dataset diff and migration"]
  Leaflet["S4: Leaflet adapter"]
  OpenLayers["S4: OpenLayers adapter"]
  RN["S5: React Native adapter"]
  Offline["Mobile/offline cache policy"]
  Demo["S7: Hosted Turkey demo"]
  Game["S8: Game package"]
  Hardening["S9: Production hardening and release"]

  S0 --> Registry
  S0 --> Artifacts
  S0 --> Checksums

  Checksums --> Registry
  Artifacts --> Registry
  Registry --> Rollback
  Registry --> Demo

  TR012 --> Artifacts
  TR012 --> Registry

  ADM3Infra --> ADM3Source
  ADM3Infra --> Quality
  ADM3Infra --> StableIds
  ADM3Source --> Quality
  Quality --> Artifacts
  Quality --> MVT
  MVT --> Artifacts

  StableIds --> DiffMigration
  Registry --> DiffMigration
  DiffMigration --> Hardening

  Registry --> Leaflet
  Registry --> OpenLayers
  Registry --> RN
  Offline --> RN
  Registry --> Offline

  Leaflet --> Demo
  OpenLayers --> Demo
  RN --> Hardening
  Demo --> Hardening

  Registry --> Game
  StableIds --> Game
  Game --> Hardening
  Rollback --> Hardening
```

## Dependency Notes

| Node                         | Depends on                                                | Reason                                                                                              |
| ---------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Release truth                | none                                                      | Documentation and npm registry state currently disagree, so it is the safest precondition.          |
| Hosted registry              | release truth, artifact publishing, checksum verification | A registry is only production-grade if referenced artifacts are immutable and verifiable.           |
| Artifact publishing          | source locks, quality gates                               | CDN artifacts should not be uploaded without source/license and geometry checks.                    |
| Turkey ADM3 source expansion | ADM3 ingestion infrastructure                             | Source expansion before ingestion hardening would multiply manual exceptions.                       |
| Leaflet/OpenLayers           | runtime and hosted registry                               | Adapters should use the same loading path as MapLibre rather than invent per-adapter data plumbing. |
| React Native                 | offline cache policy and hosted registry                  | Mobile needs deterministic cache, update, and verification behavior.                                |
| Dataset diff/migration       | stable IDs and registry versions                          | Migrations only matter once releases are versioned and comparable.                                  |
| Hosted Turkey demo           | hosted registry and published artifacts                   | The demo should prove production loading, not local artifact paths.                                 |
| Game package                 | stable data/runtime APIs                                  | Game helpers should not force late breaking changes into geospatial packages.                       |
| Production hardening         | all production flows                                      | Rollback, monitoring, and CI budgets are meaningful only after the production pipeline exists.      |
