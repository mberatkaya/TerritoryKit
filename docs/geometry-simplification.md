# Geometry Simplification

`territory geometry simplify` creates build-time geometry tiers:

```bash
territory geometry simplify ./dist/tr/levels/ADM2/dataset.json \
  --strategy topology-safe \
  --detail high,medium,low \
  --output ./dist/tr/levels/ADM2/simplified \
  --report ./dist/tr/levels/ADM2/simplification-report.json
```

The TypeScript backend represents shared polygon boundaries as canonical topology arcs and
simplifies each arc once. Adjacent polygons then reuse the same simplified coordinates, reversing
the arc when they traverse the boundary in the opposite direction, so shared boundaries do not
independently diverge during simplification.

A tier is omitted when its geometry hash matches the source hash, so the build never publishes fake
`medium` or `low` variants. Omitted tiers are still audited; a hash-equal tier is not reported as
quality-success when the source geometry is already invalid. Runtime packages do not depend on
Python or GEOS.

## Simplification Report v2

The simplification report includes an overall `ok` verdict and one `topologyAudit` per requested
detail tier. `topologyAudit.ok` is true only when:

- every source shared-boundary relationship can be found identically across its simplified owners,
  allowing reversed traversal and fewer intermediate coordinates; and
- output geometry validation has zero errors.

`sharedSegmentCountBefore` and `sharedSegmentCountAfter` are diagnostic counters. Segment reduction
is expected and is not a topology failure.

`sharedBoundaryMismatchCount` counts canonical source shared-boundary relationships whose
corresponding simplified output chain cannot be found identically across all owning polygons,
allowing reversed traversal. For example, a source boundary `P0 -> P1 -> P2 -> P3 -> P4` simplified
by both owners to `P0 -> P2 -> P4` reports `sharedBoundaryMismatchCount: 0`, even though the shared
segment count decreased.

The audit also runs TerritoryKit geometry validation on the exact dataset object that is serialized
for the tier. The simplification validation profile enables coordinates, rings, self-intersections,
holes, bbox, center, and antimeridian checks. Parent containment and sibling overlap checks are left
off for this generic simplification command; shared-boundary consistency is handled by the topology
audit itself.

Topology issues use stable structured codes:

- `SHARED_BOUNDARY_MISSING`
- `SHARED_BOUNDARY_MISMATCH`
- `SHARED_BOUNDARY_OWNER_MISMATCH`
- `SIMPLIFIED_GEOMETRY_INVALID`

CLI exit behavior:

- `0`: simplification completed and every requested tier passed its audit
- `1`: simplification completed, but at least one tier failed topology or geometry quality
- `2`: invalid usage, configuration, unavailable backend, or another execution setup failure

Migration note: report v1 approximated `sharedBoundaryMismatchCount` from disappeared shared
segments. Report v2 counts actual shared-boundary relationship failures. Code that interpreted the
old value as a reduction metric should use the shared segment counters instead.
