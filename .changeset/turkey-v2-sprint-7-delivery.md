---
"@territory-kit/dataset": minor
"@territory-kit/generators": minor
"@territory-kit/runtime": minor
"@territory-kit/registry": major
"@territory-kit/cli": minor
---

Add source-aware Turkey V2 MVT metadata, deterministic delivery and source-diff manifests, and a checksum-verified district resolver with explicit estimated-boundary control, manifest pinning, explicit local registry access, URL trust options, and streaming size limits. The registry URL defaults now require HTTPS and same-origin artifacts, so this is a breaking security change: HTTP, local-file and cross-origin callers must opt in explicitly. Changesets will determine the synchronized fixed-family version after merge; no package version is hard-coded.
