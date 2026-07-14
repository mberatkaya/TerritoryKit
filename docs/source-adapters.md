# Source Adapters

Source adapters convert provider-specific boundary files into the shared TerritoryKit source
pipeline. They live in `@territory-kit/generators` because they are build-time data production
logic, not core runtime engine behavior.

## Responsibilities

An adapter declares:

- source id and display name;
- supported ADM levels;
- local or remote transport support;
- input formats;
- default license and attribution requirements;
- provider option validation;
- fetch, verify, parse, normalize, and transform functions.

Adapters should not repair geometries, invent missing legal boundary meaning, publish large
artifacts, or write directly to the console. They return structured issues and let the CLI decide
how to display them.

## Registry

Built-in adapters are registered explicitly:

```ts
import { createDefaultTerritorySourceRegistry } from "@territory-kit/generators";

const registry = createDefaultTerritorySourceRegistry();
const adapter = registry.get("natural-earth");
```

The registry rejects duplicate ids, normalizes ids, returns deterministic lists, and can be created
per test to avoid global mutable state.

## Adapter vs Dataset Builder

An adapter handles source-specific conversion. A dataset builder handles artifact layout and curated
dataset conventions. Natural Earth ADM0 uses both: the adapter feeds the common pipeline, then the
existing `world-countries` artifact builder writes the Sprint 1-compatible files.

## Adding an Adapter

Implement `TerritorySourceAdapter`, add focused fixtures, register it in the built-in adapter list,
and document:

- supported inputs and ADM levels;
- required options;
- license and attribution behavior;
- known source limitations;
- whether remote fetch and cache are supported.
