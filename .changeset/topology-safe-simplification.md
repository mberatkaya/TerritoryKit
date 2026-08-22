---
"@territory-kit/generators": patch
"@territory-kit/cli": patch
---

Fix topology-safe geometry simplification so shared polygon boundaries are simplified once as
canonical arcs and reused by adjacent polygons instead of being independently simplified per ring.
