# Dataset ID Conventions

TerritoryKit global territory IDs are stable, lowercase identifiers designed for long-lived joins.
They are not display names.

## Format

```text
<country>
<country>:<admin-level>:<stable-local-id>
```

Examples:

```text
tr
tr:adm1:34
tr:adm2:fatih
us:adm1:ca
us:adm2:los-angeles-county
```

Rules:

- `country` is ISO 3166-1 alpha-2, normalized to lowercase for IDs.
- `admin-level` is `adm1`, `adm2`, `adm3`, or `adm4` in IDs.
- `ADM0` uses only the country code, so `tr:adm0:turkey` is invalid.
- `stable-local-id` is lowercase ASCII with words separated by `-`, `_`, or `.`.
- Official codes and source-system IDs are preferred over slugs made from names.

## Deterministic Creation

```ts
import { createTerritoryGlobalId } from "@territory-kit/dataset";

const countryId = createTerritoryGlobalId({ countryCode: "TR" });
const districtId = createTerritoryGlobalId({
  countryCode: "TR",
  adminLevel: "ADM2",
  localId: "Fatih Ilcesi"
});

console.log(countryId); // "tr"
console.log(districtId); // "tr:adm2:fatih-ilcesi"
```

## Same Names

Two regions with the same name must still have different IDs. Use a parent-aware official code or a
source ID:

```text
us:adm2:springfield-ma
us:adm2:springfield-il
```

Do not use only `springfield` when multiple candidates exist.

## Name Changes

Changing a display name should not change the territory ID. Store display names in
`properties.territory.names` and keep the stable official/source code in the ID.

## Country Code Changes

If ISO 3166-1 changes, create a dataset migration note. The old ID should remain resolvable through
aliases or migration metadata until downstream users can update joins safely.

## No Official Code

When no official code exists, use a documented source-system ID. If a source has no stable ID,
create a deterministic local slug from normalized source fields and record the source fields used.
This is a fallback, not the preferred path.

## Source IDs

Source IDs are valid when they are stable within a provider and release series:

```text
br:adm3:ibge-3550308
fr:adm2:insee-75
```

Prefixing with the source family can avoid collisions between official systems.

## Collisions

Importers must fail on ID collisions. If two input features produce the same ID, the importer should
prefer a more specific official/source code rather than appending random suffixes.

## Unicode and Slugs

Slug creation is deterministic:

- trim whitespace;
- normalize Latin diacritics;
- lowercase;
- replace non-ASCII separators with `-`;
- collapse repeated separators;
- reject empty output.

```ts
import { slugifyTerritoryIdPart } from "@territory-kit/dataset";

console.log(slugifyTerritoryIdPart("Diyarbakir Buyuksehir")); // "diyarbakir-buyuksehir"
```

For production global data, prefer official/source codes even when slugging is available.
