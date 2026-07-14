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
| `1.0.0`         | Sprint 10 | Stable release                                 | Release readiness branch   |

Maintainers track completion status against sprint tasks, deliverables, acceptance criteria,
tests, and documentation.

Sprint 10 does not add new public API or schema behavior. It freezes the current package
surface, prepares the `1.0.0` version plan, refreshes release evidence, and leaves package
publishing to the post-merge Release workflow.

See [Remaining Sprint Checklist](./sprint-checklist.md) for the branch-level completion
evidence and final release gates.
