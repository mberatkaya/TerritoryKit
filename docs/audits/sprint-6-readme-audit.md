# Sprint 6 README Audit

Reviewed all 21 tracked first-party READMEs. Excluded dependencies, generated output, caches, and Git internals.

Reviewed: 21. Changed: 4. Unchanged: 17.

| README path                                | Reviewed | Changed | Reason                                                                                           |
| ------------------------------------------ | -------- | ------- | ------------------------------------------------------------------------------------------------ |
| `README.md`                                | yes      | yes     | Direct verified npm profile/packages; separate historical national snapshot and Smart candidate. |
| `examples/react-native-maplibre/README.md` | yes      | no      | Current package/example scope remains accurate; no national fallback claim to change.            |
| `packages/adapter-core/README.md`          | yes      | no      | Current package/example scope remains accurate; no national fallback claim to change.            |
| `packages/cli/README.md`                   | yes      | yes     | National Smart input flags, source lock, resume, and developer emergency flag.                   |
| `packages/core/README.md`                  | yes      | no      | Current package/example scope remains accurate; no national fallback claim to change.            |
| `packages/data-de/README.md`               | yes      | no      | Current package/example scope remains accurate; no national fallback claim to change.            |
| `packages/data-id/README.md`               | yes      | no      | Current package/example scope remains accurate; no national fallback claim to change.            |
| `packages/data-jp/README.md`               | yes      | no      | Current package/example scope remains accurate; no national fallback claim to change.            |
| `packages/data-tr/README.md`               | yes      | yes     | Historical descriptor retained; Smart candidate and explicit version/migration.                  |
| `packages/data-us/README.md`               | yes      | no      | Current package/example scope remains accurate; no national fallback claim to change.            |
| `packages/dataset/README.md`               | yes      | no      | Current package/example scope remains accurate; no national fallback claim to change.            |
| `packages/game/README.md`                  | yes      | no      | Current package/example scope remains accurate; no national fallback claim to change.            |
| `packages/generators/README.md`            | yes      | yes     | Standard/organic resolver and emergency-only legacy contract.                                    |
| `packages/leaflet/README.md`               | yes      | no      | Current package/example scope remains accurate; no national fallback claim to change.            |
| `packages/maplibre/README.md`              | yes      | no      | Current package/example scope remains accurate; no national fallback claim to change.            |
| `packages/migration/README.md`             | yes      | no      | Current package/example scope remains accurate; no national fallback claim to change.            |
| `packages/nestjs/README.md`                | yes      | no      | Current package/example scope remains accurate; no national fallback claim to change.            |
| `packages/openlayers/README.md`            | yes      | no      | Current package/example scope remains accurate; no national fallback claim to change.            |
| `packages/react-native/README.md`          | yes      | no      | Current package/example scope remains accurate; no national fallback claim to change.            |
| `packages/registry/README.md`              | yes      | no      | Current package/example scope remains accurate; no national fallback claim to change.            |
| `packages/runtime/README.md`               | yes      | no      | Current package/example scope remains accurate; no national fallback claim to change.            |

The public npm registry confirms `mberat` maintains `@territory-kit/core`, `@territory-kit/cli`,
and `@territory-kit/generators`, each at `2.1.0`. The root README links directly to
[the npm profile](https://www.npmjs.com/~mberat) immediately below the title. Public manifest
repository, homepage, bugs, and license metadata were audited; existing correct metadata is retained.

All 19 public packages were checked against the npm registry on 2026-09-27. Each latest
release lists `mberat` as publisher and maintainer. Sixteen latest releases are `2.1.0`;
`@territory-kit/leaflet` and `@territory-kit/openlayers` remain at `1.2.12`, and
`@territory-kit/react-native` remains at `1.1.13`. This audit does not publish or bump packages.
The [machine-readable registry audit](../../reports/baselines/sprint-6-npm-audit.json) records
each package and its direct registry endpoint. All 19 repository manifests already contain
repository, homepage, bugs, and license fields.

## Final Geographic Calibration Audit

All 21 first-party READMEs were reviewed again for scope and claims. The same four changed; the
other 17 remain accurate. The matrix above remains the full inventory. New text describes coarse
Voronoi ownership, shared real-barrier routing, estimated gameplay semantics and angle-independent
unsupported-straight diagnostics. The accepted rc.1 baseline is labeled separately from rc.2.
The root npm publisher/profile and core, CLI and generators links are retained. No package version
was changed and nothing was published.

The rc.2 acceptance status is explicit in all four updated READMEs: 949/973 accepted, 24
failed, seven unavailable and 58 approved polygons omitted by two precision exceptions.
The [calibration report](../../reports/baselines/sprint-6-geographic-calibration.json) records
these blockers; the README audit does not assert that the candidate is publish-ready.
