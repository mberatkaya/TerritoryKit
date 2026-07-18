# Roadmap

| Product version | Sprint    | Focus                                          | Status                     |
| --------------- | --------- | ---------------------------------------------- | -------------------------- |
| `0.0.1`         | Sprint 0  | Monorepo, tooling, ADR, CI, PRD, risk register | Complete                   |
| `0.1.0-alpha.1` | Sprint 1  | Dataset schema, validation, fixtures           | Hardened on roadmap branch |
| `0.1.0`         | Sprint 2  | Core zone engine                               | Hardened on roadmap branch |
| `0.2.0-alpha.1` | Sprint 3  | Spatial index and coordinate lookup            | Hardened on roadmap branch |
| `0.2.0`         | Sprint 4  | Hierarchy and adjacency graph                  | Hardened on roadmap branch |
| `0.3.0`         | Sprint 5  | Zoom level and viewport queries                | Hardened on roadmap branch |
| `0.4.0`         | Sprint 6  | MapLibre adapter                               | Hardened on roadmap branch |
| `0.5.0`         | Sprint 7  | NestJS and PostGIS integration                 | Hardened on roadmap branch |
| `0.6.0`         | Sprint 8  | Generator and CLI tools                        | Hardened on roadmap branch |
| `0.9.0-rc.1`    | Sprint 9  | Docs, quality, performance                     | Verified on roadmap branch |
| `1.0.0`         | Sprint 10 | Stable release                                 | Prepared on release branch |
| Pending `1.2.0` | Sprint 11 | Runtime contracts and adapter boundaries       | Merged to main             |
| Pending `1.2.0` | Sprint 12 | Runtime viewport lifecycle                     | Merged to main             |
| Pending `1.2.0` | Sprint 13 | Catalogs, binary indexes, and worker loading   | In progress on branch      |

The table above describes the historical sprint track, not blanket production availability for
every adapter or dataset. Current implementation gaps and partial items are tracked in
[Product Gap Analysis](./product-gap-analysis.md). In particular, Leaflet, OpenLayers, React Native,
`@territory-kit/game`, hosted production registry, hosted live demo, and dataset diff/migration
tooling remain future-roadmap items unless their package or workflow exists in this repository.

Maintainers track completion status against sprint tasks, deliverables, acceptance criteria,
tests, documentation, release handoff, and future roadmap work in the master sprint checklist.

Sprint 11 adds `@territory-kit/adapter-core`, `@territory-kit/runtime`, shared coded errors, and a
deprecated core registry compatibility path. Sprint 12 adds runtime viewport request orchestration,
debounce, cancellation with committed-state restoration, stale response and stale adapter operation
guards, memory LRU cache ownership policy, lazy engine reuse, managed adapter source binding, and
renderer-independent adapter updates. Sprint 13 adds a runtime multi-dataset catalog, engine pool,
binary spatial index artifacts, CLI index build/inspect/validate commands, and injectable worker
loading contracts. MVT generation and additional renderer adapters remain future work unless their
package or workflow exists in this repository.

See [Master Sprint Checklist](./sprint-checklist.md) for branch-level completion evidence,
repo-owned hardening work, external handoff, and post-1.0 roadmap items.
