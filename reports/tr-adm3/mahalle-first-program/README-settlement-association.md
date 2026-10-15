# Sprint 2C — Fatih settlement semantic association

## Commands

```sh
pnpm data:tr:mahalle-first:fatih-settlement-association
```

Requires local pinned inputs (read-only):

- rc.8 shard: `.territory/national-geometry-remediation/candidate-rc8-impl-rev1/`
- OSM barrier + seeds: `.territory/sprint-6/calibration/barriers/`

## Outputs

| Path                                                                                      | Purpose                                                |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `.territory/mahalle-first-pilot/fatih-settlement-association/settlement-association.json` | Versioned association artifact + `.sha256`             |
| `fatih-settlement-association.json`                                                       | Report copy for review                                 |
| `fatih-settlement-association-comparison.json`                                            | 30 zone / 71 seed baseline diff                        |
| `fatih-settlement-geometry-invariant.json`                                                | Pinned rc.8 shard SHA-256 + fingerprint vs v1.7 replay |
| `fatih-rc8-shard-pin.json`                                                                | Expected rc.8 Fatih shard byte pin (fail-closed)       |

## Legal / provenance

- Seeds are OSM-derived locality points; **not** licensed official mahalle polygons.
- ODbL license name on the seed snapshot is **identified** only; publication/redistribution remains `pending` for this sprint (records may be `SOURCE_REVIEW_REQUIRED` while zone summaries stay geometric).
- `contentHash` is semantic and excludes `builtAt`; report file SHA-256 includes `builtAt`.
- Official inventory name cross-check: `NOT_ASSESSED` (no governed inventory wired in this sprint).
