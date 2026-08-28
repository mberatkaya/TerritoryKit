# Turkey ADM3 OSM Coverage

OSM administrative ADM3 polygons are handled as a separate ODbL source class. The configured extract is https://download.geofabrik.de/europe/turkey-latest.osm.pbf, with metadata from Geofabrik's Turkey page.

Only closed way/relation administrative boundary polygons are eligible. Nodes such as place=neighbourhood, place=suburb, or place=quarter are not polygons and are rejected.

The current checked-in national report marks OSM administrative polygons as not-built; OSM provider records do not contribute real ADM3 coverage until a built OSM administrative artifact is supplied.

Sprint 5 adds a separate OSM barrier snapshot pipeline for roads, railways, water, parks, landuse,
and locality seeds. Those artifacts feed smart-derived generated fallback and do not count as OSM
administrative polygons. See [Turkey OSM barrier snapshots](./turkey-osm-barrier-snapshots.md).
