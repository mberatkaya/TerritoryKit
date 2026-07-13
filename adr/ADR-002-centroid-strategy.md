# ADR-002: Centroid Strategy

## Status

Accepted for `0.1.0`.

## Context

TerritoryKit needs deterministic `zoneToCenter` values for labels, examples, and simple
camera targeting. The MVP datasets are administrative polygons in GeoJSON/WGS84, but the
first package line is not trying to solve high-precision global geodesic analytics.

## Decision

Use planar polygon centroid calculation for MVP, weighted by outer-ring area for
MultiPolygons. If a polygon area is degenerate, fall back to the geometry bbox center.

Geodesic centroid calculation is deferred until after `1.0` and must arrive behind a
separate explicit API or strategy option.

## Consequences

- Centroid output is deterministic and cheap enough for dataset load and examples.
- Coordinates near poles, very large territories, or antimeridian-spanning polygons can have
  label centers that are visually acceptable but not geodesically exact.
- Import pipelines should normalize or split antimeridian cases before MVP validation.
