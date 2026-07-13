# Schema Migrations

The MVP keeps schema migrations explicit and boring.

## `territory-schema@1`

The first schema stores a manifest and a flat list of polygon zones. Hierarchy and neighbor
links are id references, while dynamic ownership or score state stays outside the geometry
dataset.

## Migration Rules

- Patch-level package releases must not silently change `territory-schema@1`.
- A breaking dataset shape requires a new schema id and a migration note.
- A geometry-only source update changes `datasetVersion`, `sourceDate`, and `geometryHash`,
  but can keep the same schema id.
- Backward compatibility tests must load representative old fixtures before a release
  candidate is marked ready.

Antimeridian-spanning polygons are documented as a post-MVP hardening area. Until then,
import pipelines should split or normalize those geometries before validation.
