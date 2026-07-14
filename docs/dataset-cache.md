# Dataset Cache

The Node registry cache stores verified artifacts under:

```text
<cache-root>/datasets/<dataset-id>/<version>/<artifact-id>/
```

Each artifact directory contains the original verified `artifact` bytes and `metadata.json`.
Metadata records dataset id, version, artifact id, sha256, size, source URL, registry hash,
installation time, verification time, content type, and compression.

```bash
territory cache list --cache-dir ./.cache/territory
territory cache verify --cache-dir ./.cache/territory
territory cache clear --cache-dir ./.cache/territory --force
```

Corrupt artifacts are ignored and replaced on the next online install. Offline installs fail with a
clear error when a required artifact is missing.
