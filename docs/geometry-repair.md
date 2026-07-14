# Geometry Repair

Repair is explicit opt-in through `repairGeometryDataset` or `territory geometry repair`. Validation
commands do not repair datasets.

## Safe Strategy

The implemented `safe` strategy may:

- close an unclosed ring by appending the first coordinate.
- remove consecutive duplicate coordinates.
- recompute `bbox` from geometry.
- recompute `center` with the existing dataset center policy.
- normalize ring orientation only when `normalizeRingOrientation` or
  `--normalize-ring-orientation true` is set.

It does not repair self-intersections, hole topology, sibling overlaps, coordinate order mistakes,
or antimeridian splits.

## Audit And Revalidation

Every repaired feature records:

- zone id and geometry type.
- original and repaired geometry hashes.
- operation list and JSON paths.
- area before, area after, absolute delta, and delta ratio.
- `accepted` or `rejectionReason`.

After accepted repairs are applied, the repaired dataset is validated again. A repair command exits
with `3` if any feature is rejected or revalidation fails.

## Area Delta

`maximumAreaDeltaRatio` defaults to `0.000001`. Set a different value when repairing old artifacts
whose stale metadata or open rings produce a known acceptable area delta.

```sh
territory geometry repair ./dataset \
  --checks basic \
  --maximum-area-delta-ratio 0.00001 \
  --output ./dataset-repaired \
  --report ./repair-report.json
```
