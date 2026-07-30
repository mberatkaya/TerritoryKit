# Rollback

Rollback procedures depend on what has been released. npm package versions and dataset
artifact paths are immutable; rollback changes the active pointer or ships a forward fix.

## PR Rollback

Before publish, rollback is a normal Git revert:

```sh
git revert <merge-commit>
pnpm verify
pnpm release:hardening
```

Open a follow-up PR with the failing evidence and the revert commit. Do not delete the
original branch while incident review is active.

## npm Package Rollback

npm versions are immutable. Do not unpublish a public package except for a narrow legal or
credential incident that maintainers explicitly approve.

1. Stop the `Release` workflow.
2. Identify the last known-good version for each affected package.
3. Move `latest` back to the last known-good version with `npm dist-tag add`.
4. Deprecate the bad version with a clear message if consumers should avoid it.
5. Add a Changeset for a forward patch release.
6. Run `pnpm verify`, `pnpm package:dry-run`, and `pnpm release:hardening`.
7. Publish the forward fix through the normal release workflow.

## Dataset Registry Rollback

Hosted dataset rollback changes only the mutable registry pointer. Immutable artifact
directories such as `tr/0.1.0/` must not be rewritten.

1. Stop dataset publish workflows.
2. Fetch `rollback/<dataset>/<version>.rollback.json`.
3. Confirm the recorded previous registry hash matches the registry pointer you intend to
   restore.
4. Restore the previous registry JSON to the active registry key.
5. Run registry verification:

```sh
territory registry verify \
  --registry https://datasets.example.com/registry.json \
  --dataset territory-kit-tr
```

6. Run local smoke checks:

```sh
pnpm registry:smoke
pnpm registry:publish:smoke
```

7. Keep bad immutable artifacts for investigation unless legal review requires removal.

## Turkey Dataset Rollback

If the Turkey ADM0-ADM2 build regresses:

1. Keep the previous source lock and artifact checksums.
2. Re-run `.github/workflows/turkey-dataset-build.yml` manually from `main`.
3. Compare `release-performance-summary.json`, adjacency reports, geometry reports, and
   benchmark output to the previous accepted workflow artifact.
4. Do not activate a registry pointer when strict validation, checksums, or benchmark
   comparison fail.
5. Publish a new dataset version after source or generator fixes; do not mutate an
   already-published immutable version.

## Communication

Release notes must state whether the rollback is package-only, registry-only, or both.
For security incidents, keep exploit detail private until a fixed version and advisory are
ready.
