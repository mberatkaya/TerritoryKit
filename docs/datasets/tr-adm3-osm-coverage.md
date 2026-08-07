# Turkey ADM3 OSM Coverage

OSM is handled as a separate ODbL source class. The configured extract is https://download.geofabrik.de/europe/turkey-latest.osm.pbf, with metadata from Geofabrik's Turkey page.

Only closed way/relation administrative boundary polygons are eligible. Nodes such as place=neighbourhood, place=suburb, or place=quarter are not polygons and are rejected.
