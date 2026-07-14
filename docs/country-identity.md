# Country Identity

Pilot country builds create `identity-map.json` next to the datasets. The identity map records the
canonical TerritoryKit id, admin level, parent id, source id, official codes, names, and stability
class for every built zone.

## Stability Classes

- `official-code`: uses country or official administrative code metadata.
- `source-stable-code`: uses a stable provider code such as `shapeID`.
- `source-id`: falls back to the provider feature id.
- `name-parent-fallback`: uses a normalized name plus parent key when no stable code is available.

Country quality policy rejects a build when too many identities fall back to `name-parent-fallback`.
This keeps same-name regions safe without pretending a name-only id is strong.

## Canonical IDs

ADM0 ids are the lowercase ISO alpha-2 country code, such as `tr`. Sub-country ids use:

```text
<country>:<admin-level>:<stable-local-id>
```

For example, an ADM2 code `TR-01-A` becomes `tr:adm2:tr-01-a`.

## Diffing

`compareTerritoryIdentityMaps(previous, next)` is exported from `@territory-kit/generators` for
release review. It reports unchanged, added, removed, source-id changed, name changed, and parent
changed identities.
