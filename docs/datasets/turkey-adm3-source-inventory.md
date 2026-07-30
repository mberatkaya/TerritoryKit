# Turkey ADM3 Source Inventory

Turkey ADM3 source expansion is tracked in
`datasets/registry/tr-adm3-sources.json`. The registry is intentionally separate from
`datasets/sources/TR/adm3-catalog.json`: candidate, inaccessible, license-unclear, and metadata-only
sources must not be promoted into the production source catalog.

Review date: `2026-07-30`

## Summary

| Status               | Province count | Production eligible |
| -------------------- | -------------: | ------------------- |
| approved             |              0 | no                  |
| candidate            |              3 | no                  |
| inaccessible         |              1 | no                  |
| license-unclear      |              1 | no                  |
| geometry-unavailable |             76 | no                  |

No province was built from a newly approved live ADM3 source in this sprint. Existing historical
Gaziantep ADM3 artifacts remain partial, but the current Gaziantep download host did not resolve
during this review and is not treated as a fresh production-approved source.

## Reviewed Candidates

| Province  | Status          | Evidence                                                                                  | Blocker                                                         |
| --------- | --------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Bursa     | candidate       | Official Bursa open data page, open license, GeoJSON, 1074 features, 7812408 bytes        | raw SHA-256 changed across repeated downloads                   |
| Gaziantep | inaccessible    | ULASAV page still exposes metadata, CC BY 4.0, KML resource metadata, historical checksum | referenced download host did not resolve                        |
| Sakarya   | candidate       | Official Sakarya open data page, license, stable GeoJSON checksum, 677 features           | EPSG:5254 requires reprojection adapter                         |
| Trabzon   | candidate       | ULASAV/Trabzon page, CC BY 4.0, stable GeoJSON checksum, 716 features                     | missing district parent field                                   |
| Muğla     | license-unclear | Official municipal page references MAKS-derived vector neighbourhood data                 | no redistribution license; informational-only notice; EPSG:5253 |

## Production Catalog Rule

`datasets/sources/TR/adm3-catalog.json` contains only production-approved sources. After the
2026-07-30 review there are no live approved ADM3 province sources in that catalog. A source can be
promoted only after all of these are true:

- the current source URL is reachable and can be locked;
- raw source checksum and byte size are stable;
- license allows redistribution and derivative use with attribution requirements recorded;
- ADM3 semantics are explicit and compatible with `neighbourhood`, `village`, `locality`, or a
  compatible administrative unit;
- district parent mapping can be resolved deterministically;
- CRS is `EPSG:4326` or an explicit reprojection adapter exists;
- fixture/source-lock/build evidence is committed without committing the large raw artifact.

## Adding The Next Source

1. Add a candidate row to `datasets/registry/tr-adm3-sources.json`.
2. Record source URL, download URL, license URL, source date, feature count, parent field, name
   field, stable source ID field, CRS, byte size, checksum, and known blockers.
3. If the source becomes approved, add the corresponding province entry to
   `datasets/sources/TR/adm3-catalog.json`.
4. Run `territory country source lock TR --levels ADM0,ADM1,ADM2,ADM3 --adm3-provinces <code>`.
5. Run `territory country build TR --allow-partial` and inspect coverage, hierarchy, geometry, and
   identity reports.
