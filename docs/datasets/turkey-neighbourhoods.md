# Turkey Neighbourhoods

TerritoryKit includes reviewed Turkey semantics for `ADM3 -> neighbourhood / Mahalle` and one
official partial Gaziantep pilot. This is not nationwide Turkey neighbourhood coverage.

## Gaziantep Pilot

The first legally redistributable Turkey ADM3 artifact is
`datasets/generated/countries/TR/levels/ADM3`. It covers Gaziantep province neighbourhood polygons
from Gaziantep Büyükşehir Belediyesi's "Mahalle Sınır Alanları" KML published through the Ulusal
Akıllı Şehir Açık Veri Platformu.

- Coverage: 786 `ADM3` neighbourhoods for the 9 Gaziantep `ADM2` district parents.
- Status: `partial`; no nationwide Turkey ADM3 coverage is claimed.
- Production strict status: `not ready`; `production-quality-report.json` records unresolved
  self-intersection, parent-containment, and sibling-overlap findings.
- License: CC BY 4.0.
- Source URL: <https://ulasav.csb.gov.tr/dataset/27-mahalle-sinir-alanlari>
- Download URL:
  <https://acikveri.gaziantep.bel.tr/dataset/5fac9bc5-8cc0-4883-8805-1f71149319db/resource/df82c9ce-f69d-4cc2-bf57-d4a36ed1c144/download/mahalle_sinirlari-1.kml>
- Locked source SHA-256:
  `f145ae9edd2db7a341634e14d59060a535258461794d361c3f49bdec2bcbfa9a`.
- Attribution: `Gaziantep Büyükşehir Belediyesi, Mahalle Sınır Alanları, CC BY 4.0`.

The raw KML is cached under `.territory/cache/` during local builds and is not committed. The
committed artifacts include `sources.lock.json`, `source-metadata.json`, `source-evaluation.json`,
`coverage.json`, `repair-report.json`, `repair-details.json`, `production-quality-report.json`,
`overlap-audit.json`, `parent-containment-report.json`, adjacency, query, and MVT render outputs.

Artifact policy:

- `full.geojson` is the only committed GeoJSON render tier.
- `medium.geojson` and `low.geojson` are intentionally omitted until a shared-boundary-aware
  simplifier is implemented and tested.
- MVT render output is intentionally generated only for zoom `12`; the render manifest must not
  claim `z13` or `z14` support for this pilot.
- `pnpm data:tr:adm3:artifact-policy` fails duplicate GeoJSON tier hashes, oversized reports,
  over-budget tile counts, oversized tiles, or total output above the declared budget.

Current generated hardening results:

- GEOS/Shapely repair backend: Shapely 2.1.2 / GEOS 3.13.1.
- Repair classification: 775 precision-normalized only, 4 geometry-repaired, 7
  component-discarded, 0 rejected.
- Discarded components: 9 polygonal components recorded in `repair-details.json`; all are marked
  `safeToDiscard: true` by the current MakeValid/min-area policy and require review before this can
  be treated as production-ready.
- Overlap audit: 62 adjacency candidates excluded from the neighbour graph and retained in
  `overlap-audit.json`.
- Parent containment: 0 unresolved parent mappings and 0 ambiguous parent mappings, but 252 ADM3
  zones currently have TypeScript strict containment findings against the existing ADM2 geometry
  context.

Rebuild or validate the pilot with:

```bash
pnpm data:tr:adm3:build
pnpm data:tr:adm3:validate
```

`pnpm data:tr:adm3:update --fetch --approve-unexpected-source` is reserved for intentional source
refreshes after reviewing the upstream checksum, license metadata, and schema report.

## Synthetic Fixture

`createTurkeyAdm3DemoDataset()` in `@territory-kit/shared-testkit` remains synthetic demonstration
data:

```text
Türkiye
└── İstanbul
    └── Fatih
        ├── Demo Neighbourhood A
        ├── Demo Neighbourhood B
        └── Demo Neighbourhood C
```

The fixture exists to test ADM3 validation, stable IDs, explicit parent links, children, adjacency,
registry fallback, and MapLibre rendering metadata. It must not be used as official boundary data.

Any future Turkey neighbourhood ingestion must pass the same official/open-data manifest gate:
source URL, source date, checksum, license, attribution, redistribution, commercial-use, and
modification status.
