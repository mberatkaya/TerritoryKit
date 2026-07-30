import { createTerritoryEngine } from "@territory-kit/core";
import type { TerritoryDatasetMigrationPlan } from "@territory-kit/dataset";
import {
  createSampleTerritoryDataset,
  createSyntheticGridDataset
} from "@territory-kit/shared-testkit";
import { describe, expect, it } from "vitest";
import {
  TERRITORY_GAME_SNAPSHOT_SCHEMA_VERSION,
  createGameEngine,
  createGameSnapshot,
  createInMemoryGameRepository,
  deserializeGameSnapshot,
  migrateGameSnapshotTerritories,
  serializeGameSnapshot
} from "../src/index.js";
import type {
  ActionRule,
  GameClock,
  GameCommandResult,
  GameSnapshot,
  TerritoryOwner
} from "../src/index.js";

describe("@territory-kit/game", () => {
  it("claims an unowned territory", async () => {
    const { game } = createGridGame();

    const result = await game.execute({
      type: "claim-territory",
      playerId: "p1",
      territoryId: "z:0:0",
      expectedVersion: 0
    });

    expect(result.ok).toBe(true);
    expect(assertSuccess(result).snapshot.territories["z:0:0"]?.owner).toEqual({
      kind: "player",
      id: "p1"
    });
    expect(assertSuccess(result).events.map((event) => event.type)).toEqual(["territory-claimed"]);
  });

  it("rejects invalid territories before state changes", async () => {
    const { game, repository } = createGridGame();

    const result = await game.execute({
      type: "claim-territory",
      playerId: "p1",
      territoryId: "missing",
      expectedVersion: 0
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "territory-not-found" },
      version: 0
    });
    expect(repository.getSnapshot("game-test")?.version).toBeUndefined();
  });

  it("rejects non-neighbor capture actions", async () => {
    const { game } = createGridGame();

    await game.execute({
      type: "claim-territory",
      playerId: "p1",
      territoryId: "z:0:0",
      expectedVersion: 0
    });
    await game.execute({
      type: "set-territory-owner",
      territoryId: "z:0:2",
      owner: { kind: "player", id: "p2" },
      expectedVersion: 1
    });

    const result = await game.execute({
      type: "capture-territory",
      playerId: "p1",
      territoryId: "z:0:2",
      expectedVersion: 2
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "not-neighbor" },
      version: 2
    });
  });

  it("allows capture from an owned neighboring territory", async () => {
    const { game } = createGridGame();

    await game.execute({
      type: "claim-territory",
      playerId: "p1",
      territoryId: "z:0:0",
      expectedVersion: 0
    });
    await game.execute({
      type: "set-territory-owner",
      territoryId: "z:0:1",
      owner: { kind: "player", id: "p2" },
      expectedVersion: 1
    });

    const result = await game.execute({
      type: "capture-territory",
      playerId: "p1",
      territoryId: "z:0:1",
      expectedVersion: 2
    });

    expect(result.ok).toBe(true);
    expect(assertSuccess(result).snapshot.territories["z:0:1"]?.owner).toEqual({
      kind: "player",
      id: "p1"
    });
    expect(assertSuccess(result).events[0]?.type).toBe("territory-captured");
  });

  it("checks parent-child actions only when hierarchy rules allow them", async () => {
    const dataset = createSampleTerritoryDataset();
    const territory = createTerritoryEngine({ dataset });
    const repository = createInMemoryGameRepository();
    const game = createGameEngine({
      territory,
      repository,
      context: { id: "hierarchy-test", kind: "match" },
      ruleConfig: {
        hierarchy: { allowParentChild: true }
      }
    });

    await game.execute({
      type: "claim-territory",
      playerId: "p1",
      territoryId: "tr:34",
      expectedVersion: 0
    });
    await game.execute({
      type: "set-territory-owner",
      territoryId: "tr:34:fatih",
      owner: { kind: "player", id: "p2" },
      expectedVersion: 1
    });

    const result = await game.execute({
      type: "capture-territory",
      playerId: "p1",
      sourceTerritoryId: "tr:34",
      territoryId: "tr:34:fatih",
      expectedVersion: 2
    });

    expect(result.ok).toBe(true);
  });

  it("enforces per-player cooldowns", async () => {
    const { game } = createGridGame({
      clock: fixedClock("2026-01-01T00:00:00.000Z"),
      ruleConfig: {
        cooldowns: { "claim-territory": 10_000 }
      }
    });

    const first = await game.execute({
      type: "claim-territory",
      playerId: "p1",
      territoryId: "z:0:0",
      expectedVersion: 0
    });
    const second = await game.execute({
      type: "claim-territory",
      playerId: "p1",
      territoryId: "z:0:1",
      expectedVersion: assertSuccess(first).version
    });

    expect(first.ok).toBe(true);
    expect(assertSuccess(first).events.map((event) => event.type)).toEqual([
      "territory-claimed",
      "cooldown-started"
    ]);
    expect(second).toMatchObject({
      ok: false,
      error: { code: "cooldown-active" }
    });
  });

  it("supports team ownership and teammate actions", async () => {
    const { game } = createGridGame({
      players: [
        { id: "p1", teamId: "blue" },
        { id: "p2", teamId: "blue" }
      ],
      teams: [{ id: "blue", displayName: "Blue" }],
      ruleConfig: { ownershipMode: "team" }
    });

    await game.execute({
      type: "claim-territory",
      playerId: "p1",
      territoryId: "z:0:0",
      expectedVersion: 0
    });
    await game.execute({
      type: "set-territory-owner",
      territoryId: "z:0:1",
      owner: { kind: "player", id: "p3" },
      expectedVersion: 1
    });

    const result = await game.execute({
      type: "capture-territory",
      playerId: "p2",
      territoryId: "z:0:1",
      expectedVersion: 2
    });

    expect(result.ok).toBe(true);
    expect(assertSuccess(result).snapshot.territories["z:0:1"]?.owner).toEqual({
      kind: "team",
      id: "blue"
    });
  });

  it("rejects concurrent claims with optimistic locking", async () => {
    const repository = createInMemoryGameRepository();
    const slowRepository = createDelayedSaveRepository(repository, 5);
    const territory = createTerritoryEngine({
      dataset: createSyntheticGridDataset({ rows: 1, columns: 1, withNeighbors: true })
    });
    const game = createGameEngine({
      territory,
      repository: slowRepository,
      context: { id: "concurrent-test", kind: "match" }
    });

    const [left, right] = await Promise.all([
      game.execute({
        type: "claim-territory",
        playerId: "p1",
        territoryId: "z:0:0",
        expectedVersion: 0
      }),
      game.execute({
        type: "claim-territory",
        playerId: "p2",
        territoryId: "z:0:0",
        expectedVersion: 0
      })
    ]);
    const results = [left, right];

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok).map((result) => result.error.code)).toEqual([
      "concurrency-conflict"
    ]);
    expect(repository.getSnapshot("concurrent-test")?.version).toBe(1);
  });

  it("returns the original result for idempotent retries", async () => {
    const { game, repository } = createGridGame();

    const command = {
      type: "claim-territory",
      playerId: "p1",
      territoryId: "z:0:0",
      expectedVersion: 0,
      idempotencyKey: "claim-z00"
    } as const;
    const first = await game.execute(command);
    const second = await game.execute(command);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(assertSuccess(second).idempotent).toBe(true);
    expect(repository.getSnapshot("game-test")?.version).toBe(1);
    expect(repository.getSnapshot("game-test")?.claims).toHaveLength(1);
  });

  it("serializes and restores snapshots", async () => {
    const { game } = createGridGame();

    const claim = await game.execute({
      type: "claim-territory",
      playerId: "p1",
      territoryId: "z:0:0",
      expectedVersion: 0
    });
    const serialized = serializeGameSnapshot(assertSuccess(claim).snapshot);
    const restored = deserializeGameSnapshot(serialized);

    expect(restored).toEqual(assertSuccess(claim).snapshot);

    const repository = createInMemoryGameRepository([restored]);
    const territory = createTerritoryEngine({
      dataset: createSyntheticGridDataset({ rows: 1, columns: 3, withNeighbors: true })
    });
    const restoredGame = createGameEngine({
      territory,
      repository,
      context: { id: "game-test", kind: "match" }
    });

    await restoredGame.execute({
      type: "set-territory-owner",
      territoryId: "z:0:1",
      owner: { kind: "player", id: "p2" },
      expectedVersion: 1
    });

    expect(repository.getSnapshot("game-test")?.version).toBe(2);
  });

  it("rejects execution when snapshot dataset version differs from the active core dataset", async () => {
    const oldSnapshot = createGameSnapshot({
      context: {
        id: "dataset-test",
        kind: "world",
        dataset: {
          id: "synthetic-grid-1x1",
          version: "old",
          geometryHash: "old-hash"
        }
      }
    });
    const repository = createInMemoryGameRepository([oldSnapshot]);
    const territory = createTerritoryEngine({
      dataset: createSyntheticGridDataset({ rows: 1, columns: 1, withNeighbors: true })
    });
    const game = createGameEngine({
      territory,
      repository,
      context: { id: "dataset-test", kind: "world" }
    });

    const result = await game.execute({
      type: "claim-territory",
      playerId: "p1",
      territoryId: "z:0:0",
      expectedVersion: 0
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "dataset-version-mismatch" }
    });
  });

  it("applies TerritoryKit migration mappings to owned territory state", () => {
    const owner: TerritoryOwner = { kind: "player", id: "p1" };
    const snapshot = createGameSnapshot({
      context: {
        id: "migration-test",
        kind: "world",
        dataset: {
          id: "sample",
          version: "1.0.0",
          geometryHash: "old-hash"
        }
      },
      now: "2026-01-01T00:00:00.000Z"
    });
    snapshot.territories["old:a"] = {
      territoryId: "old:a",
      owner,
      version: 1,
      updatedAt: "2026-01-01T00:00:00.000Z"
    };

    const migrated = migrateGameSnapshotTerritories(snapshot, migrationPlan(), {
      now: "2026-01-02T00:00:00.000Z"
    });

    expect(migrated.context.dataset).toMatchObject({
      id: "sample",
      version: "2.0.0",
      geometryHash: "new-hash"
    });
    expect(migrated.territories["new:a"]?.owner).toEqual(owner);
    expect(migrated.territories["old:a"]).toBeUndefined();
  });

  it("supports custom deterministic action rules", async () => {
    const rule: ActionRule = {
      id: "block-z01",
      priority: 1,
      evaluate(input) {
        if (input.action.territoryId === "z:0:1") {
          return {
            allow: false,
            code: "rule-rejected",
            message: "This territory is locked by a fixture rule."
          };
        }

        return { allow: true };
      }
    };
    const { game } = createGridGame({ rules: [rule] });

    const result = await game.execute({
      type: "claim-territory",
      playerId: "p1",
      territoryId: "z:0:1",
      expectedVersion: 0
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "rule-rejected" }
    });
  });

  it("keeps domain event ordering deterministic", async () => {
    const { game } = createGridGame({
      clock: fixedClock("2026-01-01T00:00:00.000Z"),
      ruleConfig: {
        cooldowns: { "claim-territory": 1_000 }
      }
    });

    const result = await game.execute({
      type: "claim-territory",
      playerId: "p1",
      territoryId: "z:0:0",
      expectedVersion: 0
    });

    expect(assertSuccess(result).snapshot.schemaVersion).toBe(
      TERRITORY_GAME_SNAPSHOT_SCHEMA_VERSION
    );
    expect(assertSuccess(result).events.map((event) => [event.sequence, event.type])).toEqual([
      [1, "territory-claimed"],
      [2, "cooldown-started"]
    ]);
  });
});

function createGridGame(options: Partial<Parameters<typeof createGameEngine>[0]> = {}) {
  const territory = createTerritoryEngine({
    dataset: createSyntheticGridDataset({ rows: 1, columns: 3, withNeighbors: true })
  });
  const repository = createInMemoryGameRepository();
  const game = createGameEngine({
    territory,
    repository,
    context: { id: "game-test", kind: "match" },
    ...options
  });

  return { game, repository, territory };
}

function assertSuccess(result: GameCommandResult) {
  expect(result.ok).toBe(true);

  return result as Extract<GameCommandResult, { ok: true }>;
}

function fixedClock(iso: string): GameClock {
  return {
    now() {
      return new Date(iso);
    }
  };
}

function createDelayedSaveRepository(
  repository: ReturnType<typeof createInMemoryGameRepository>,
  delayMs: number
) {
  return {
    ...repository,
    async saveSnapshot(snapshot: GameSnapshot, options: { expectedVersion: number }) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      await repository.saveSnapshot(snapshot, options);
    }
  };
}

function migrationPlan(): TerritoryDatasetMigrationPlan {
  return {
    schemaVersion: "territory-migration-plan@1",
    fromDataset: {
      datasetId: "sample",
      datasetVersion: "1.0.0",
      geometryHash: "old-hash",
      sourceDate: "2026-01-01"
    },
    toDataset: {
      datasetId: "sample",
      datasetVersion: "2.0.0",
      geometryHash: "new-hash",
      sourceDate: "2026-01-02"
    },
    mappings: [
      {
        oldId: "old:a",
        newId: "new:a",
        type: "renamed",
        confidence: 1,
        requiresReview: false,
        categories: ["renamed"],
        strategy: "stable-id"
      }
    ],
    reviewItems: [],
    breakingChanges: [],
    summary: {
      automaticMappingCount: 1,
      breakingChangeCount: 0,
      requiresReviewCount: 0,
      totalMappingCount: 1
    }
  };
}
