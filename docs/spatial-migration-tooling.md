# Spatial Migration Tooling

TerritoryKit includes generic dry-run tooling for mapping legacy spatial IDs, including H3 cells
represented as polygons, onto TerritoryKit territories.

The tooling is deliberately domain-neutral. It does not decide Rush&Claim ownership winners,
leaderboard updates, claim rules, or score economics.

## Input Model

Each source record can include:

- `sourceSpatialId` or `h3Index`
- `geometry`: Polygon or MultiPolygon
- `center`: `[longitude, latitude]`
- `score`
- `ownerId`
- arbitrary metadata

Example:

```json
[
  {
    "h3Index": "881ec90247fffff",
    "center": [28.9784, 41.0082],
    "geometry": {
      "type": "Polygon",
      "coordinates": [
        [
          [28.97, 41.0],
          [28.99, 41.0],
          [28.99, 41.02],
          [28.97, 41.02],
          [28.97, 41.0]
        ]
      ]
    },
    "score": 120,
    "ownerId": "user-1"
  }
]
```

## CLI

```bash
territory migrate-spatial \
  --source source-zones.json \
  --target-dataset .territory/build/TR/V2-national/dataset.json \
  --strategy max-overlap \
  --target-level 3 \
  --source-system rushandclaim-h3 \
  --source-version h3-resolution-8 \
  --output migration-plan.json
```

The command is always a dry-run. It does not mutate a database.

## Strategies

### Centroid

`centroid` maps the source center through TerritoryKit point lookup.

Use it when source polygons are unavailable or as a fast smoke check. It does not preserve boundary
overlap evidence.

### Maximum Overlap

`max-overlap` intersects the source polygon with candidate target territory polygons and sorts
targets by source overlap ratio.

This is the preferred historical H3 migration strategy because H3 cells and administrative/custom
territories do not have a 1:1 relationship.

## Confidence

The output confidence is geometry-derived:

- `EXACT`: nearly all source area maps to one territory
- `HIGH`: one territory clearly dominates
- `AMBIGUOUS`: multiple territories have similar or low-confidence overlap
- `NO_MATCH`: no target territory matched

## Multi-target Mapping

The plan keeps all significant target overlaps:

```json
{
  "sourceSpatialId": "h3-a",
  "targetTerritoryId": "territory-x",
  "strategy": "max-overlap",
  "confidence": "AMBIGUOUS",
  "overlapRatio": 0.6,
  "targets": [
    { "targetTerritoryId": "territory-x", "overlapRatio": 0.6 },
    { "targetTerritoryId": "territory-y", "overlapRatio": 0.4 }
  ]
}
```

Consumers can choose to squash, split, or manually review these records.

## Conflicts

If multiple source owners map to the same target territory, the plan emits a conflict:

```json
{
  "targetTerritoryId": "territory-x",
  "sourceSpatialIds": ["h3-a", "h3-b"],
  "ownerIds": ["user-1", "user-2"]
}
```

TerritoryKit reports the conflict but does not choose the winner.

## Manifest

Each dry-run plan contains:

- source system
- source version
- target dataset ID
- target dataset version
- target geometry hash
- target level
- mapping strategy
- generated timestamp
- tool version
- summary counts

This makes historical migration artifacts reproducible and reviewable in the later Rush&Claim
migration sprint.
