# Game Territory Engine

`@territory-kit/game` is an optional domain package for games that need territory ownership,
neighbor actions, cooldowns, snapshots, and persistence without putting game state into
`@territory-kit/core`.

Core remains the geometry engine. The game package asks core whether a territory exists, what its
parent/children are, and whether two same-level territories are neighbors. It does not know about
GeoJSON, map renderers, vector tiles, or backend frameworks.

## Install

```bash
pnpm add @territory-kit/core @territory-kit/game
```

## Basic API

```ts
import { createTerritoryEngine } from "@territory-kit/core";
import { createGameEngine, createInMemoryGameRepository } from "@territory-kit/game";

const territory = createTerritoryEngine({ dataset, adjacency });
const gameEngine = createGameEngine({
  territory,
  repository: createInMemoryGameRepository(),
  context: { id: "world-1", kind: "world" }
});

const result = await gameEngine.execute({
  type: "claim-territory",
  playerId,
  territoryId,
  expectedVersion: 0,
  idempotencyKey: "claim-1"
});
```

`result.ok === true` returns the new `GameSnapshot`, emitted `GameEvent[]`, and an audit entry.
Validation failures return typed error codes and do not mutate the snapshot.

## What Is Included

- unowned territory claims
- ownership changes and captures
- player and team ownership
- neighbor-required actions
- optional parent-child action checks
- action validation and custom rule plugins
- cooldowns through an injected clock
- optimistic concurrency with `expectedVersion`
- idempotent command retry handling
- deterministic domain events
- snapshot serialization and restore
- dataset version checks and migration-plan support
- repository contracts and an in-memory repository
- injectable random source for custom rules that need randomness

## What Stays Out

`@territory-kit/core` still has no player, team, score, cooldown, capture, or ownership state.
Production multiplayer systems still need authentication, matchmaking, realtime fanout, durable
event streaming, anti-cheat/rate limits, presence, analytics, and operational monitoring outside
this package.
