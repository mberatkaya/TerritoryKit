# Turkey ADM3 Source Strategy

TerritoryKit models Turkey ADM3 as source discovery first. This registry does not invent mahalle polygons and does not automatically promote discovered sources into production artifacts.

## Priority

| Priority | Source class       | Meaning                                                                                |
| -------- | ------------------ | -------------------------------------------------------------------------------------- |
| P0       | official-national  | National authoritative ADM3 geometry with usable redistribution rights.                |
| P1       | official-local     | Municipal official open vector dataset with approved license and source-lock evidence. |
| P2       | official-local     | Municipal official GIS/API/WFS source that needs adapter, access, or license review.   |
| P3       | official-local     | Other official government source or authority export.                                  |
| P4       | osm-administrative | OSM administrative polygon fallback candidate; never authoritative for Turkey ADM3.    |
| P5       | smart-derived      | Derived estimated fallback class emitted only by the smart fallback pipeline.          |
| P6       | synthetic-test     | Synthetic test/gameplay class; not emitted by Sprint 2.                                |

## National Sources

- MAKS/NVI is the authority path for spatial address registry data, but no public redistributable ADM3 polygon API or download is locked.
- TUCBS is the national platform and request channel. Access is identity- and permission-mediated; source-owner approval still controls reuse.
- NVI/UAVT supplies stable address identifiers, not a public polygon distribution endpoint.
- Harita Genel Mudurlugu publishes national administrative boundary products, but the current ADM3/mahalle production fit remains license and layer-scope review work.

## Authority vs Redistribution

Authority and redistribution are separate fields. A municipality or national system may be authoritative for a boundary while its license state remains unknown, restricted, or review-required. TerritoryKit only sets `productionEligible: true` when the source is authoritative, license-approved, redistributable, and has enough source-lock evidence.

## License Review

License review is intentionally conservative. Public map visibility, a working REST endpoint, or an official provider name is not enough to embed geometry in a redistributable package. If terms are not explicit, the source remains review-required, restricted, or unknown.
