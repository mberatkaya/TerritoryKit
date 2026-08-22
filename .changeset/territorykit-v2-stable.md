---
"@territory-kit/adapter-core": major
"@territory-kit/cli": major
"@territory-kit/core": major
"@territory-kit/data-de": major
"@territory-kit/data-id": major
"@territory-kit/data-jp": major
"@territory-kit/data-tr": major
"@territory-kit/data-us": major
"@territory-kit/dataset": major
"@territory-kit/generators": major
"@territory-kit/game": major
"@territory-kit/maplibre": major
"@territory-kit/nestjs": major
"@territory-kit/registry": major
"@territory-kit/runtime": major
---

Prepare TerritoryKit V2 for the stable `2.0.0` release handoff.

This release promotes the Turkey V2 national playable dataset contract to
`territory-kit-tr-v2-playable@2.0.0`, with the complete 1 ADM0 / 81 ADM1 / 973 ADM2 Turkey
hierarchy and nationwide playable ADM3 coverage. The ADM3 source policy remains
official > OSM > generated; generated fallback zones are deterministic, playable, explicitly
generated, and non-official.

The release hardens the national build, registry, source-lock, checksum, topology, geometry,
provenance, attribution, and strict validation gates that protect the resolver-driven external
artifact model. Large national geometry remains outside npm packages.

Migration note: `territory-schema@1` is unchanged and legacy `territory-kit-tr` resolution remains
separate. Consumers opting into `territory-kit-tr-v2-playable` should preserve the generated-zone
semantics and must not treat generated fallback as official Turkish mahalle/koy administrative
data.
