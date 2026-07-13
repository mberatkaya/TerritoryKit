# TerritoryKit Risk Register

| Risk                                | Impact | Likelihood | Mitigation                                              |
| ----------------------------------- | ------ | ---------- | ------------------------------------------------------- |
| Dirty or malformed GeoJSON          | High   | High       | Validation CLI, repair suggestions, fixture tests       |
| World-scale dataset size            | High   | Medium     | Viewport filtering, simplification, future MVT roadmap  |
| Map adapter API differences         | Medium | High       | Capability interface and fallback style policy          |
| Hierarchy inconsistency             | High   | Medium     | Cycle/orphan validators and schema rules                |
| Game logic leaking into core        | Medium | Medium     | Keep game features in a future `game` package           |
| Early API breakage                  | High   | Medium     | Experimental labels during `0.x`, RC before `1.0`       |
| License or data-source mismatch     | High   | Medium     | Separate code and dataset license checks                |
| Complex polygon lookup latency      | High   | Medium     | Spatial index, benchmarks, simplification guidance      |
| Antimeridian/projection assumptions | Medium | Medium     | Document RFC 7946 limits and defer geodesic engine work |
| Documentation drifting from code    | Medium | Medium     | Checklist, API docs, and examples as release gates      |
| Invalid API input reaching storage  | High   | Medium     | NestJS request validation before repository calls       |
| Stale generated geometry metadata   | Medium | Medium     | Dataset bbox/center checks and deterministic CLI hashes |

## Review Cadence

- Update this register whenever a sprint introduces a new public API, dataset source, adapter, generator, or backend integration.
- Do not mark a sprint complete until all high-impact risks introduced by that sprint have an explicit mitigation or follow-up checklist item.
