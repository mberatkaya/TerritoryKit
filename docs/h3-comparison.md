# H3 And TerritoryKit Comparison

TerritoryKit is inspired by the developer experience of H3, not by H3's geometry model. H3 uses globally indexed regular hexagon and pentagon cells. TerritoryKit uses dataset-defined Polygon and MultiPolygon territories.

| Criterion                 | H3                             | TerritoryKit                                                       |
| ------------------------- | ------------------------------ | ------------------------------------------------------------------ |
| Geometry                  | Regular hexagon/pentagon cells | Irregular Polygon/MultiPolygon zones                               |
| Coverage                  | Global mathematical grid       | Dataset-dependent, optionally global                               |
| Hierarchy                 | Built-in resolution system     | Dataset-defined level and parent-child system                      |
| Neighbor lookup           | Mathematical grid traversal    | Graph-based adjacency and logical connections                      |
| Rendering                 | Not included                   | Adapter packages such as MapLibre                                  |
| Game features             | Not included                   | Kept outside core, later `game` package                            |
| Administrative boundaries | Approximation through cells    | Native fit for province/district/neighborhood boundaries           |
| Performance               | Very high by design            | Depends on spatial index, geometry complexity, and dataset quality |

## API Mapping

| H3 API           | TerritoryKit API | Status               |
| ---------------- | ---------------- | -------------------- |
| `latLngToCell`   | `latLngToZone`   | Baseline implemented |
| `cellToBoundary` | `zoneToBoundary` | Baseline implemented |
| `gridDisk`       | `zoneNeighbors`  | Baseline implemented |
| `cellToParent`   | `zoneToParent`   | Baseline implemented |
| `cellToChildren` | `zoneToChildren` | Baseline implemented |
| `polygonToCells` | `polygonToZones` | Implemented          |
| `isValidCell`    | `isValidZone`    | Baseline implemented |

## Non-Goals

- TerritoryKit will not recreate H3's global geodesic grid.
- TerritoryKit will not treat game state as core geometry.
- TerritoryKit will not hide dataset quality problems behind silent repairs.

## Product Positioning

TerritoryKit succeeds when it can manage real or custom polygon regions through a predictable, versioned, H3-like API across Node.js, browser maps, and backend services.
