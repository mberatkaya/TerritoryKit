# Sprint 2C — Fatih settlement semantic association

## Commands

```sh
pnpm data:tr:mahalle-first:fatih-settlement-association
```

Requires local pinned inputs (read-only):

- rc.8 shard: `.territory/national-geometry-remediation/candidate-rc8-impl-rev1/`
- OSM barrier + seeds: `.territory/sprint-6/calibration/barriers/`

## Outputs

| Path                                                                                      | Purpose                                    |
| ----------------------------------------------------------------------------------------- | ------------------------------------------ |
| `.territory/mahalle-first-pilot/fatih-settlement-association/settlement-association.json` | Versioned association artifact + `.sha256` |
| `fatih-settlement-association.json`                                                       | Report copy for review                     |
| `fatih-settlement-association-comparison.json`                                            | 30 zone / 71 seed baseline diff            |
| `fatih-settlement-geometry-invariant.json`                                                | Zone ID + fingerprint proof vs v1.7 replay |

## Legal / provenance

- Seeds are OSM-derived locality points; **not** licensed official mahalle polygons.
- Official inventory name cross-check: `NOT_ASSESSED` (no governed inventory wired in this sprint).
