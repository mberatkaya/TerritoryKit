# Registry Hosting

Build a registry from country artifact directories:

```bash
territory registry build \
  --input ./dist/datasets \
  --output ./dist/registry.json \
  --base-url https://cdn.example.test/datasets/ \
  --build-date 2026-01-01T00:00:00.000Z \
  --force
```

The builder scans directories containing `manifest.json` and `checksums.json`, emits deterministic
dataset and artifact ordering, records sha256 and size for every installable file, and includes
`checksums.json` as metadata so strict loaders can verify installed content.

Use `SOURCE_DATE_EPOCH` or `--build-date` for reproducible `generatedAt` values. Host the registry
and artifact files without rewriting relative paths.
