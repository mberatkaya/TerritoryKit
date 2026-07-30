# @territory-kit/game

Renderer-independent territory ownership and action engine for games built on TerritoryKit.

```ts
import { createTerritoryEngine } from "@territory-kit/core";
import { createGameEngine, createInMemoryGameRepository } from "@territory-kit/game";

const gameEngine = createGameEngine({
  territory: createTerritoryEngine({ dataset }),
  repository: createInMemoryGameRepository(),
  context: { id: "world-1", kind: "world" }
});

const result = await gameEngine.execute({
  type: "claim-territory",
  playerId,
  territoryId,
  expectedVersion: 0,
  idempotencyKey: "command-1"
});
```

`@territory-kit/game` stores ownership, teams, cooldowns, scores, contests, events, snapshots, and
audit records outside `@territory-kit/core`. Core remains responsible for territory validity,
hierarchy, and adjacency only.
