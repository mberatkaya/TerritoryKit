# Registry Deployment Example

`.github/workflows/dataset-registry-publish.yml` is a provider-neutral manual workflow. It is not a
production deployment by itself.

## What It Does

- runs only through `workflow_dispatch`
- separates artifact build and registry publish jobs
- uses no secrets in the artifact build job
- gates the publish job behind the `dataset-registry-production` environment
- stops safely when `dry_run` is false and `TERRITORY_REGISTRY_PUBLISH_ENABLED` is not `true`
- uploads the prepared registry object tree as a GitHub Actions artifact for provider sync

## Required Repository Setup

Create an environment named `dataset-registry-production` and configure reviewers before allowing
non-dry-run dispatches. Add provider-specific secrets only to that protected environment.

Suggested secret:

```text
TERRITORY_REGISTRY_PUBLISH_ENABLED=true
```

Provider-specific credentials are intentionally not named in the workflow. Add them only when a
specific object-store sync step is reviewed.

## Dispatch Inputs

Use example or staging URLs until production storage is ready:

```text
dataset=territory-kit-tr
version=0.1.0
levels=ADM0,ADM1,ADM2
base_url=https://datasets.example.invalid/tr/0.1.0/
artifact_prefix=tr/0.1.0
dry_run=true
```

The `version` input must match `manifest.json` in the built artifact. The workflow default uses
`0.1.0` because current country artifact builders emit that dataset version unless changed by a
future build pipeline.

## Provider Sync

After review, add a provider-specific sync step after `territory registry publish` and before the
final artifact upload. The sync should upload exactly `dist/publish/registry/**` to the bucket or
CDN origin that backs `base_url`.

Run this after the sync:

```bash
territory registry verify \
  --registry "$PUBLIC_REGISTRY_URL" \
  --dataset territory-kit-tr \
  --version 0.1.0
```

Do not add real production URLs or tokens to this repository.
