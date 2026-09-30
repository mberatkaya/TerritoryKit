# Sprint 7 publishing evidence

## Capability audit

| Requirement                 | Existing baseline                                            | Sprint 7 action                                                                               |
| --------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Canonical national geometry | Sprint 6 full ADM3 and full GeoJSON                          | Preserved; no canonical generation changes                                                    |
| Province/district loading   | 81 province and 973 district shards                          | Indexed in a versioned delivery manifest                                                      |
| MVT                         | Sprint 6 tile generator and policy validator                 | Added source version and ADM2 parent identity; regenerated candidate tiles locally            |
| Adjacency                   | Canonical topology artifact and validator                    | Reused, indexed checksum                                                                      |
| Spatial lookup              | Query artifact and binary-index infrastructure               | Reused, indexed checksum                                                                      |
| Attribution                 | `attribution.json` and text                                  | Added consumer helper to select notices for loaded IDs                                        |
| Source locks                | Pinned national and OSM locks                                | Added deterministic source diff command and province rebuild scope                            |
| API/SDK                     | Catalog/runtime/MapLibre/NestJS                              | Added district resolver subpath with SHA-256 verification and explicit estimated control      |
| Release workflow            | Private root, fixed Changesets group, guarded publish script | Security hardening revised the Changeset to major; no publication or stable dataset promotion |

## Candidate and delivery measurements

The Sprint 6 candidate `2.1.0-rc.7` passed strict publish-ready validation again: 973/973 successful districts, 81 provinces, no failed districts, and 99.999979% final coverage. The canonical national geometry hash remains `fb19b468c0555dd0e167d5937037b1609f610014d9231c80b4bc9834685dd8f3`; the ADM3-only geometry hash remains `19f50ba312657f39f61d9ce8eb6562491fa66de106681eec5352b85ae1b6e333`.

The delivery-only local rebuild emitted 18,856 tiles at zoom 10–12 from that ADM3 input. All tiles decoded and matched their SHA-256 checksums. Across 139,576 decoded feature appearances, all 20,392 canonical ADM3 IDs were present, with zero unknown IDs, parent mismatches, source-class mismatches, or Smart administrative-semantics failures. The largest rebuilt tile was 160,491 bytes; total tile payload was 75,027,044 bytes. Tile bytes differ from the Sprint 6 set because Sprint 7 adds metadata. The rebuilt MVT directory passed `territory render validate`. No PBF files or large national artifacts are committed.

The new manifest indexes the 18,856 tiles and 1,054 shards, with checksum index hash `f0ebef67fa6add89f56ad62afd4ce22684da6936449b9c3f1e8faac6dd1a4be5`. Its content hash is `55a70b952b01dec86fff95453491efad0959b41110927d83b8ecf8eb4c977ee6`. The existing unrefreshed Sprint 6 candidate manifest is a distinct delivery identity. Hosting the new manifest requires hosting the rebuilt tiles and matching checksums together.

For a representative Istanbul viewport `[28.9, 40.9, 29.2, 41.2]`, the rebuilt delivery uses four z10 tiles totaling 243,903 bytes, or 28 z12 tiles totaling 501,343 bytes. The largest district shard is 7,726,980 bytes; the largest province shard is 42,445,959 bytes. The canonical full ADM3 GeoJSON is 306,692,530 bytes. These measurements exclude transport headers and compression.

## Version and release policy

The npm registry and local manifests were checked for all 19 public workspace packages. The 15-package fixed family is currently `2.1.0` and receives a pending major Changeset due to the stricter registry URL defaults, yielding `3.0.0` after the normal version step. Changesets also schedules patch releases for Leaflet, OpenLayers, React Native, and Migration because their `workspace:*` dependencies need updated ranges for the fixed family. The root remains private at `0.0.0-private`. The Turkey dataset candidate remains `2.1.0-rc.7`; stable dataset promotion requires separate geometry and quality review.

The complete package-by-package registry result is in the [npm audit](../../reports/baselines/sprint-7-npm-audit.json). The release hardening gate passes with zero critical advisories after upgrading repository MapLibre development and example dependencies to the patched 6.x line. The public MapLibre peer range stays compatible with existing consumers; applications should select a patched MapLibre version.

The package tarball audit and clean temporary consumer import smoke cover ESM, CJS, CLI help, runtime delivery, generator exports, MapLibre, and NestJS (with its framework peers installed). The real publish script was not run. After merge, maintainers should run Changesets versioning on `main`, review the versioned package manifests and dependency ranges, run release checks and the guarded publish workflow, then create the GitHub release only after npm verification.

`pnpm verify`, `pnpm release:check`, `pnpm release:hardening` (before the current vulnerability policy), registry install/publish smokes, package dry run, docs link check, and strict Turkey V2 national validation passed. The guarded publish script's `--dry-run` found no unpublished packages at the current `2.1.0` manifests; it must be rerun after Changesets versioning to assess the actual Changesets publication set.

## README audit

All 19 first-party package READMEs and the root README were reviewed. Changed: root, CLI, Dataset, Generators, Runtime, and MapLibre. Reviewed and unchanged: Adapter Core, Core, Registry, NestJS, Data TR, Data US/DE/JP/ID, Game, Migration, React Native, Leaflet, and OpenLayers. The unchanged files do not need new delivery instructions.

## Remaining integration work

The new MVT set and delivery manifest are generated locally and excluded by the large-artifact policy. A host must publish them atomically with the checksum inventory. Source-lock diff identifies changed sources and affected provinces; exact changed ADM2 IDs and geometry require a candidate rebuild and dataset/quality comparison. No stable dataset promotion, npm publication, GitHub release, or Rush&Claim rollout has occurred.

The security hardening audit supersedes the earlier release-hardening pass: the current audit finds high dependency advisories, and `pnpm release:hardening` now fails until they are resolved or a reviewed exception is recorded. See [Sprint 7 security hardening](turkey-sprint-7-security-hardening.md).
