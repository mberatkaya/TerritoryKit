---
"@territory-kit/generators": minor
"@territory-kit/cli": minor
---

Harden Turkey V2 national publish-ready validation and artifact integrity checks.

Adds strict 1/81/973 national completeness metadata, separates diagnostic `quality.ok` from
`quality.publishReady`, removes placeholder registry artifact checksums, validates registry artifacts
against real SHA-256 and byte sizes, and upgrades `territory tr v2 national validate` with
machine-readable strict publish-ready failures.
