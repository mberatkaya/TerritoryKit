# Registry Rollback

Hosted dataset rollback changes only the mutable active registry pointer. Immutable artifact paths
such as `tr/1.0.0/` must not be rewritten or deleted during the incident response.

## Rollback Manifest

Each publish writes:

```text
rollback/<dataset>/<version>.rollback.json
```

The manifest contains:

- released dataset id and version
- active registry key
- immutable registry key
- previous active registry hash
- previous active registry snapshot
- restore action

## Procedure

1. Stop further publish jobs for the affected dataset.
2. Fetch the rollback manifest for the bad version.
3. Confirm the `previous.registryHash` matches the active registry version you intend to restore.
4. Write `previous.registry` back to the `restore.targetRegistryKey`, usually `registry.json`.
5. Run hosted verification:

```bash
territory registry verify \
  --registry https://datasets.example.com/registry.json \
  --dataset territory-kit-tr
```

6. Keep the bad immutable version artifacts for investigation unless license or legal review
   requires removal.

Rollback does not republish geometry. It only changes which registry manifest clients discover as
active.

## Safety Notes

- Do not edit immutable version manifests in place.
- Do not roll back to a registry that points at revoked or unlicensed data.
- Prefer object-store versioning or retention locks for `registry.json`.
- Document the incident and publish a forward fix for the next dataset version.
