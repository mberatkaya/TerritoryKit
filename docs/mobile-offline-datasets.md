# Mobile Offline Datasets

Mobile offline datasets are installed through `@territory-kit/react-native` from a registry or from
an inline registry object. The install path is staged and verified before the active dataset pointer
is updated.

## Install Flow

1. Load and validate the registry.
2. Select an exact pinned dataset version.
3. Download selected query, render, and `.tksi` binary index artifacts into `.partial/`.
4. Validate size and SHA-256 checksum for each artifact.
5. Write the installed dataset manifest into staging.
6. Move the complete staged dataset into `datasets/<dataset>/<version>/`.
7. Update `active/<dataset>.json` last.

If a download is interrupted, the active manifest still points at the previous complete dataset.
`cleanupPartialDownloads()` removes stale `.partial` content on startup or after an install failure.

## Offline Startup

After a successful online install, apps can restart without network access:

```ts
const mobileRuntime = createMobileTerritoryRuntime({
  registryUrl,
  storageAdapter,
  offline: true
});

const result = await mobileRuntime.queryViewport({
  datasetId: "territory-kit-tr",
  viewport
});
```

`offline: true` reads the registry snapshot from storage when registry metadata is needed. Viewport
queries read installed artifacts directly and do not require the registry network path.

Point lookup follows the same installed-data contract:

```ts
const located = await mobileRuntime.queryPoint({
  datasetId: "territory-kit-tr",
  coordinate: { lat: 41.01, lng: 28.95 },
  level: 3
});
```

If the dataset is not installed, the runtime throws `DATASET_NOT_FOUND`. It does not synthesize a
grid, H3 cell, or fallback polygon.

## Network Fallback

When `fallbackToInstalledOnNetworkError` is not disabled, registry network failures fall back to the
stored registry snapshot. The runtime emits `network-fallback` so applications can surface stale
offline state in UI or telemetry.

## Version Upgrade And Rollback

Installing a newer pinned version writes a new complete dataset directory and then updates the
active pointer. The active manifest records the previous version:

```ts
await mobileRuntime.installDataset({
  datasetId: "territory-kit-tr",
  version: "1.1.0"
});

await mobileRuntime.rollbackDataset({ datasetId: "territory-kit-tr" });
```

Rollback only switches the active pointer to an already installed complete version. It does not
download or mutate artifacts.

Applications can check invalidation before deciding to install:

```ts
const status = await mobileRuntime.checkDatasetStatus({
  datasetId: "territory-kit-tr"
});

if (status.updateAvailable) {
  // Prompt or schedule installDataset({ datasetId, version: status.availableVersion })
}
```

The status response compares the active installed version with the registry or offline registry
snapshot and reports `installedVersion`, `availableVersion`, `stale`, and `updateAvailable`.

## Binary Indexes

Artifacts with `purpose: "index"` and `format: "tksi"` are decoded with the core binary spatial
index loader and passed into `createTerritoryEngine`. If an index checksum or metadata check fails,
the installed dataset load fails instead of silently falling back to an unverified index.

## Artifact Scope

Do not embed a full Turkey fixture in mobile tests or examples. CI tests should use tiny synthetic
registry artifacts. Production apps should install the specific levels and regions they need, and
prefer render artifacts for maps while loading query artifacts lazily for search and selection.
