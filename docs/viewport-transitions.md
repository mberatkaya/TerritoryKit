# Viewport Transitions

TerritoryKit resolves exactly one level for a viewport at a time. During zoom transitions,
`getLevelTransition({ bounds, fromZoom, toZoom })` returns the previous level, next level,
and entering/exiting zone ids so render adapters can fade parent zones out while children fade
in without painting both sets as final state.

`getViewportCacheKey({ bounds, zoom, level })` includes dataset id, dataset version,
geometry hash, cache revision, resolved level, and normalized bounds. Change the cache revision
when adapter state or server-side viewport policy changes.

Fast pan/zoom behavior should treat transition payloads as disposable. If a newer viewport
request arrives, discard the older payload and render only the latest resolved level.
