# Turkey Neighbourhoods

TerritoryKit includes reviewed Turkey semantics for `ADM3 -> neighbourhood / Mahalle`.

The repository does not include official or nationwide Turkey neighbourhood geometry. The
`createTurkeyAdm3DemoDataset()` shared-testkit fixture is synthetic demonstration data:

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

Production Turkey neighbourhood ingestion requires an official/open-data manifest with source URL,
source date, checksum, license, attribution, and redistribution status.
