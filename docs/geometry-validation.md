# Geometry Validation

Geometry validation is validate-only by default. It never mutates the input dataset and never
silently repairs coordinates.

## Checks

`basic` checks:

- coordinate finiteness and WGS84 range.
- consecutive duplicate coordinates.
- ring length, closure, non-zero area, and orientation info.
- bbox shape and bbox-vs-geometry mismatch.

`full` checks add:

- candidate-filtered ring self-intersection detection.
- hole containment, duplicate holes, hole overlap, and hole/shell intersection.
- MultiPolygon duplicate or overlapping components.
- center range, bbox containment, and polygon containment warning.
- antimeridian crossing and wide-bbox policy warnings.
- parent geometry covering child geometry.
- sibling overlap grouped by parent and level.

Sibling, component, hole, and self-intersection checks first use bbox candidate filtering. They avoid
unconditional all-pairs exact geometry comparisons for normal datasets.

## Issue Model

Each issue includes:

- `code`, `severity`, `check`, `message`, and `path`.
- `zoneId`/`featureId` and optional related ids.
- `repairable` and `repairSuggestion` when a safe repair exists.
- `details` for comparison metadata.

`strict: true` promotes validation warnings to errors. Informational orientation notes stay info.

## CLI

```sh
territory geometry validate ./dataset \
  --checks full \
  --strict \
  --epsilon 1e-9 \
  --report ./geometry-report.json
```

`--backend typescript` is the implemented backend. `--backend postgis` is rejected until a real
PostGIS backend is wired.
