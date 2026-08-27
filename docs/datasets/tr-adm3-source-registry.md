# Turkey ADM3 Source Registry

Machine-readable files:

- `datasets/sources/TR/adm3/source-registry.json`
- `datasets/sources/TR/adm3/source-registry.schema.json`
- `datasets/sources/TR/adm3/national-assessments.json`
- `reports/tr-adm3/source-coverage.json`

## Source Status

| Status                  | Meaning                                                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| official-ready          | Official vector source has approved license and enough evidence to be production-eligible after explicit ingestion approval.              |
| official-license-review | Official source exists, but license, adapter, CRS, parent mapping, or field evidence still needs review.                                  |
| official-restricted     | Authority source exists only through restricted, authenticated, or request-required channels.                                             |
| official-service-only   | Official GIS/API/WFS-like service is visible, but no reviewed open download/source lock exists.                                           |
| partial-official        | Official evidence exists but is only a rendered map, table, partial district source, or otherwise not province-wide vector ADM3 geometry. |
| osm-candidate           | No usable official source is known; OSM is tracked only as a fallback candidate.                                                          |
| research-required       | The province needs additional discovery before even a fallback decision is reliable.                                                      |
| unavailable             | No usable or candidate source is currently known.                                                                                         |

## Adding A Province Source

Update `datasets/registry/tr-adm3-source-inventory.json` with provider, source URL, access URL, format, license, rights, feature count, fields, status, and evidence URLs. Then run:

```sh
pnpm data:tr:adm3:sources
```

Do not add checksums for sources that have not been downloaded through an approved ingestion path. Do not set `productionEligible` through manual edits; the generator derives it from source status and license/redistribution evidence.

## Production Safety

The source registry is discovery infrastructure. It does not change `datasets/sources/TR/adm3-catalog.json`, does not download new polygon files, and does not add discovered provinces to the production Turkey V2 build.
