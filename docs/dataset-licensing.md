# Dataset Licensing

TerritoryKit does not choose one default source for all global boundaries. Each provider has
different license, attribution, redistribution, and worldview constraints. Import pipelines must
record the source license and preserve attribution in manifests and generated artifacts.

This document is not legal advice. Check the source license for the exact release being imported.

## Natural Earth

Natural Earth states that its raster and vector map data are public domain and may be used without
permission. It also provides optional citation text such as "Made with Natural Earth."

Why it needs a separate pipeline:

- it is well suited for ADM0 and small-scale map display;
- it is not a full country-internal administrative boundary source;
- detail levels and generalized coastlines must be documented;
- attribution can still be useful even when not required.

Source: [Natural Earth Terms of Use](https://www.naturalearthdata.com/about/terms-of-use/)

## geoBoundaries

geoBoundaries describes its open country dataset as CC BY 4.0, and its pages state that attribution
is required. Some API families distinguish open, humanitarian, and authoritative variants with
different license implications.

Why it needs a separate pipeline:

- attribution is required for the open dataset;
- source metadata can vary by country and administrative level;
- worldview policy is source-specific;
- importer code must pin release, country, ADM level, and checksum.

Sources:

- [geoBoundaries](https://www.geoboundaries.org/)
- [geoBoundaries API](https://www.geoboundaries.org/api.html)

## OpenStreetMap

OpenStreetMap data is licensed under ODbL, an attribution and share-alike database license.
Derived databases may carry share-alike obligations, so OSM should not be mixed into default
global artifacts without a dedicated legal and technical pipeline.

Why it needs a separate pipeline:

- attribution must be preserved;
- share-alike obligations can affect derived database distribution;
- OSM boundaries are community maintained and may differ from official administrative records;
- downstream products may need ODbL-specific notices and source separation.

Sources:

- [OpenStreetMap Copyright and License](https://www.openstreetmap.org/copyright)
- [OpenStreetMap Foundation ODbL FAQ](https://osmfoundation.org/wiki/Licence/Licence_and_Legal_FAQ)

## GADM

GADM documents free academic and non-commercial use, while redistribution or commercial use is not
allowed without prior permission. That restriction makes it unsuitable as a default packaged source
for TerritoryKit global artifacts.

Why it needs a separate pipeline:

- commercial use and redistribution require special handling;
- artifacts may not be publishable in the same way as open datasets;
- importer tests should use small fixtures and never imply blanket redistribution rights;
- documentation must explain allowed use for any generated artifact.

Source: [GADM License](https://gadm.org/license.html)

## Official Government Sources

Official government boundary data varies by jurisdiction. Some sources are public domain; others
require attribution, forbid commercial use, restrict redistribution, or publish only under custom
terms.

Why each source needs a separate pipeline:

- the official code system may differ from ISO or local statistics codes;
- update cadence and source dates vary;
- terms may apply to specific files, APIs, or map services;
- disputed boundary policy may reflect a national worldview;
- attribution text may be prescribed by the source.

Every official-source importer must store the source URL, source date, license, attribution,
artifact checksum, and any usage limitations in the manifest.
