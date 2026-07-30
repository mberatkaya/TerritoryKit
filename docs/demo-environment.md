# Demo Environment

The Turkey web demo reads only public, non-secret environment variables.

| Variable                           | Required       | Default                 | Purpose                                                           |
| ---------------------------------- | -------------- | ----------------------- | ----------------------------------------------------------------- |
| `VITE_TERRITORY_DEMO_MODE`         | No             | `auto`                  | `fixture`, `registry`, or auto-select registry when a URL exists. |
| `VITE_TERRITORY_REGISTRY_URL`      | Registry mode  | none                    | Public hosted `registry.json` URL.                                |
| `VITE_TERRITORY_DATASET_ID`        | No             | `territory-kit-tr`      | Registry dataset id.                                              |
| `VITE_TERRITORY_DATASET_VERSION`   | Production yes | `latest-compatible`     | Dataset version or range used for pinning.                        |
| `VITE_TERRITORY_ALLOW_PRERELEASE`  | No             | `false`                 | Allows prerelease registry versions.                              |
| `VITE_MAP_STYLE_URL`               | No             | token-free inline style | Optional user-supplied MapLibre style URL.                        |
| `VITE_TERRITORY_BASE_PATH`         | Static subpath | `/`                     | Vite base path for GitHub Pages or subdirectory hosting.          |
| `VITE_TERRITORY_TELEMETRY_ENABLED` | No             | `false`                 | UI flag only. The demo does not add analytics.                    |

Validation behavior:

- Missing registry URL with `auto` mode starts fixture mode.
- Missing registry URL with `VITE_TERRITORY_DEMO_MODE=registry` shows an explicit configuration
  error and fixture fallback.
- Invalid registry URLs are shown in the fallback panel.
- Telemetry is off by default and no external analytics script is included.
- Do not put API tokens in style URLs or registry URLs. Prefer public read-only origins.

Recommended production registry settings:

```bash
VITE_TERRITORY_DEMO_MODE=registry
VITE_TERRITORY_REGISTRY_URL=https://YOUR_PUBLIC_DATASET_ORIGIN/registry.json
VITE_TERRITORY_DATASET_VERSION=0.1.0
VITE_TERRITORY_BASE_PATH=/territorykit/
```

See [Registry Deployment Example](./examples/registry-deployment.md) and
[Artifact Publishing](./artifact-publishing.md) for the hosted artifact workflow.
