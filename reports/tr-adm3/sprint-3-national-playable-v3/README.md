# Sprint 3 — Nationwide playable-v3

Coordinate-free nationwide metrics and sample district QA for the `2.1.0-playable-v3` candidate.

| Artifact                   | Description                                                                              |
| -------------------------- | ---------------------------------------------------------------------------------------- |
| `sample-metrics.json`      | Multi-region hybrid sample (Istanbul, Ankara, Izmir, Antalya, eastern rural, Eyüpsultan) |
| `nationwide-closeout.json` | rc.7/rc.8 baseline comparison after full national build                                  |
| `OZET.md`                  | Human-readable closeout summary                                                          |

Local MapLibre previews (not committed): `.territory/sprint-3/playable-v3/map-preview/`

Candidate bytes: `.territory/sprint-3/playable-v3/candidate/` (does not replace rc.7 or rc.8).

Parent ADM0–ADM2 uses the canonical geoBoundaries-backed `datasets/generated/countries/TR/dataset.json` so OSM barrier artifacts align with stable `tr:adm2:*` territory IDs (DEC-003 / Path B pending). National builds use `--allow-parent-provenance-mismatch` only for catalog-vs-parent provider metadata—not for missing OSM barrier locks.
