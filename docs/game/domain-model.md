# Game Domain Model

The public model is generic enough for strategy games, territory control simulations, MMO worlds,
collaborative maps, and backend-driven minigames. It does not encode one game's win condition.

## Context

`GameContext` scopes state to a `match` or `world` and records the TerritoryKit dataset reference:

```ts
{
  id: "match-2026-07-30",
  kind: "match",
  dataset: {
    id: "territory-kit-tr",
    version: "1.2.0",
    geometryHash: "..."
  }
}
```

The snapshot version is the optimistic concurrency token used by `expectedVersion`.

## Actors And Ownership

- `GamePlayer`: a player identity with optional `teamId`.
- `GameTeam`: a team identity.
- `TerritoryOwner`: `{ kind: "player" | "team", id }`.
- `GameOwnershipMode`: `"player"` or `"team"`. In team mode, player commands resolve ownership
  through the player's `teamId`.

## Territory State

`GameTerritoryState` stores the current owner and a territory-local version. Historical claim and
capture records are kept separately:

- `TerritoryClaim`: an unowned territory became owned.
- `TerritoryCapture`: an owned territory changed owner through a game action.
- `TerritoryContest`: an active or resolved challenge against a territory.
- `TerritoryScore`: a generic numeric score for a territory.
- `Cooldown`: a per-player action cooldown.

## Commands

Supported command types are:

- `claim-territory`
- `capture-territory`
- `set-territory-owner`
- `start-contest`
- `adjust-territory-score`

Commands are validated deterministically, then custom `ActionRule` plugins run in
`priority, id` order.

## Events

Current domain event types are:

- `territory-claimed`
- `territory-owner-changed`
- `territory-captured`
- `contest-started`
- `territory-score-changed`
- `cooldown-started`

Events include a monotonic `sequence` inside the snapshot. Audit entries record the command,
expected version, idempotency key, affected territories, emitted event IDs, and resulting snapshot
version.

## Custom Rules

```ts
const rule = {
  id: "season-lock",
  priority: 10,
  evaluate(input) {
    if (input.action.territoryId === "locked-zone") {
      return { allow: false, code: "rule-rejected", message: "Season locked." };
    }

    return { allow: true };
  }
};
```

Rules receive a cloned snapshot, the core-backed territory source, injected clock, and injected RNG.
Keep rules pure when multiplayer determinism matters.
