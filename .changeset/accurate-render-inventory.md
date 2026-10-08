---
"@territory-kit/generators": patch
---

Publish the actual encoded MVT source layer and zoom overrides in render manifests so native clients do not request absent tiles or an incorrect source layer.

Decode tile content during render validation to reject stale layer/zoom inventories and corrupt tiles. Bind available ADM0–ADM3 render manifests to delivery pins so consumers can use emitted metadata instead of deployment defaults.
