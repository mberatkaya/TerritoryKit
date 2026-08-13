# Turkey V2 Source Class And Provenance

Turkey V2 ADM3 zones declare `sourceClass`:

1. `official`
2. `osm`
3. `generated`

Priority is `official > osm > generated`. The hybrid builder applies that priority for
representative district and batch artifacts. Final national 81-province publication remains a
future build/release step.

`sourceClass` is the final zone semantics and must be `official`, `osm`, or `generated`.
`providerClass` is separate and can describe access policy such as `runtime` or `experimental`.
Runtime official sources still produce final `sourceClass: "official"` zones; experimental sources
remain opt-in.

## Official

Official records come from government bodies or open municipal portals with reviewed license and
attribution metadata.

Required strict metadata:

- `official: true`
- `generated: false`
- provider/source reference
- source-native ID when available
- source date
- license
- attribution
- `semanticType` of `neighbourhood` or `village`

## OSM

OSM records must be verified closed polygon/relation administrative boundaries. Place nodes, open
ways, and broken relations are not promoted to ADM3 polygons.

Required strict metadata:

- `official: false`
- `generated: false`
- OSM source-native ID such as `relation-987654`
- ODbL license and OpenStreetMap attribution
- source URL or repository provenance reference
- `semanticType` of `neighbourhood`, `village`, or reviewed administrative unit

## Generated

Generated records are TerritoryKit game zones used where no reviewed real ADM3 polygon exists.

Required strict metadata:

- `official: false`
- `generated: true`
- `semanticType: "generated-zone"`
- generator `algorithmVersion`
- deterministic seed or local key
- Apache-2.0 TerritoryKit generation attribution

Generated records are not official mahalle or köy records and must not be displayed as such.
