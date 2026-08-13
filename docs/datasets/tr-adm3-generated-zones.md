# Turkey ADM3 Generated Zones

Generated game zones fill ADM2 areas where no usable real ADM3 polygon is available. They are
deterministic, derived from ADM2 geometry plus generator configuration, and labeled with:

- `sourceClass: "generated"`
- `official: false`
- `generated: true`
- `semanticType: "generated-zone"`

Generated zones are game coverage units. They must not be displayed as official mahalle or köy
records, and they do not share official or OSM license terms.

Legacy fallback algorithm version: `tr-adm3-generated-zone-v1`.

Sprint 2 adds the KapRota-oriented V2 game-zone generator:

- algorithm version `tr-adm3-game-zone-v2`
- profiles `urban`, `suburban`, `rural`, `auto`, and `custom`
- deterministic recursive spatial partitioning instead of plain grid tessellation
- quality reports for coverage, overlap, containment, area distribution, compactness, slivers, and
  stable ID collisions
- CLI generation through `territory tr adm3 generate`

See `docs/datasets/turkey-v2-game-zone-generator.md`.

The generated fill uses real ADM2 Polygon/MultiPolygon geometry and clips grid cells to missing
district geometry. Current measured generated coverage is 99.999305%. Real/generated clipping and
national production merge remain separate build work beyond the V2 data-contract sprint.
