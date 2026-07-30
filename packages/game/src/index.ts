import type { NeighborOptions, TerritoryEngine } from "@territory-kit/core";
import { validateMigrationPlan } from "@territory-kit/dataset";
import type { TerritoryDatasetMigrationPlan } from "@territory-kit/dataset";

export const TERRITORY_GAME_SNAPSHOT_SCHEMA_VERSION = "territory-game-snapshot@1" as const;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export type GameContextKind = "match" | "world";
export type TerritoryOwnerKind = "player" | "team";
export type GameOwnershipMode = "player" | "team";

export interface GameDatasetRef {
  id: string;
  version: string;
  schemaVersion?: string;
  geometryHash?: string;
  sourceDate?: string;
}

export interface GameContext {
  id: string;
  kind: GameContextKind;
  dataset: GameDatasetRef;
  metadata?: JsonObject;
}

export interface GamePlayer {
  id: string;
  teamId?: string;
  displayName?: string;
  metadata?: JsonObject;
}

export interface GameTeam {
  id: string;
  displayName?: string;
  metadata?: JsonObject;
}

export interface TerritoryOwner {
  kind: TerritoryOwnerKind;
  id: string;
}

export interface TerritoryClaim {
  id: string;
  territoryId: string;
  owner: TerritoryOwner;
  playerId: string;
  claimedAt: string;
  territoryVersion: number;
  metadata?: JsonObject;
}

export interface TerritoryCapture {
  id: string;
  territoryId: string;
  sourceTerritoryId?: string;
  previousOwner?: TerritoryOwner;
  owner: TerritoryOwner;
  playerId: string;
  capturedAt: string;
  territoryVersion: number;
  metadata?: JsonObject;
}

export type TerritoryContestStatus = "active" | "resolved" | "cancelled";

export interface TerritoryContest {
  id: string;
  territoryId: string;
  sourceTerritoryId?: string;
  attacker: TerritoryOwner;
  defender?: TerritoryOwner;
  status: TerritoryContestStatus;
  startedAt: string;
  endsAt?: string;
  metadata?: JsonObject;
}

export interface TerritoryScore {
  id: string;
  territoryId: string;
  owner?: TerritoryOwner;
  value: number;
  updatedAt: string;
  metadata?: JsonObject;
}

export interface Cooldown {
  id: string;
  actionType: GameCommandType;
  playerId: string;
  territoryId?: string;
  startedAt: string;
  expiresAt: string;
  metadata?: JsonObject;
}

export type TerritoryCooldown = Cooldown;

export interface GameTerritoryState {
  territoryId: string;
  owner?: TerritoryOwner;
  version: number;
  updatedAt: string;
  metadata?: JsonObject;
}

export type GameEventType =
  | "territory-claimed"
  | "territory-owner-changed"
  | "territory-captured"
  | "contest-started"
  | "territory-score-changed"
  | "cooldown-started";

export interface GameEvent {
  id: string;
  sequence: number;
  type: GameEventType;
  contextId: string;
  occurredAt: string;
  territoryId?: string;
  playerId?: string;
  owner?: TerritoryOwner;
  payload?: JsonObject;
}

export interface GameAuditEntry {
  id: string;
  sequence: number;
  contextId: string;
  commandType: GameCommandType;
  playerId?: string;
  territoryId?: string;
  sourceTerritoryId?: string;
  idempotencyKey?: string;
  expectedVersion?: number;
  snapshotVersion: number;
  eventIds: string[];
  occurredAt: string;
  metadata?: JsonObject;
}

export interface GameSnapshot {
  schemaVersion: typeof TERRITORY_GAME_SNAPSHOT_SCHEMA_VERSION;
  context: GameContext;
  version: number;
  eventSequence: number;
  commandSequence: number;
  players: Record<string, GamePlayer>;
  teams: Record<string, GameTeam>;
  territories: Record<string, GameTerritoryState>;
  claims: TerritoryClaim[];
  captures: TerritoryCapture[];
  contests: Record<string, TerritoryContest>;
  scores: Record<string, TerritoryScore>;
  cooldowns: Record<string, Cooldown>;
  events: GameEvent[];
  audit: GameAuditEntry[];
  updatedAt: string;
  metadata?: JsonObject;
}

export type GameCommandType =
  | "claim-territory"
  | "capture-territory"
  | "set-territory-owner"
  | "start-contest"
  | "adjust-territory-score";

interface GameCommandBase {
  type: GameCommandType;
  contextId?: string;
  expectedVersion?: number;
  idempotencyKey?: string;
  metadata?: JsonObject;
}

export interface ClaimTerritoryCommand extends GameCommandBase {
  type: "claim-territory";
  playerId: string;
  territoryId: string;
  owner?: TerritoryOwner;
}

export interface CaptureTerritoryCommand extends GameCommandBase {
  type: "capture-territory";
  playerId: string;
  territoryId: string;
  sourceTerritoryId?: string;
  owner?: TerritoryOwner;
}

export interface SetTerritoryOwnerCommand extends GameCommandBase {
  type: "set-territory-owner";
  territoryId: string;
  playerId?: string;
  owner: TerritoryOwner | null;
}

export interface StartContestCommand extends GameCommandBase {
  type: "start-contest";
  playerId: string;
  territoryId: string;
  sourceTerritoryId?: string;
  owner?: TerritoryOwner;
  contestId?: string;
  durationMs?: number;
}

export interface AdjustTerritoryScoreCommand extends GameCommandBase {
  type: "adjust-territory-score";
  territoryId: string;
  playerId?: string;
  owner?: TerritoryOwner;
  delta: number;
  scoreId?: string;
}

export type GameCommand =
  | ClaimTerritoryCommand
  | CaptureTerritoryCommand
  | SetTerritoryOwnerCommand
  | StartContestCommand
  | AdjustTerritoryScoreCommand;

export type GameErrorCode =
  | "concurrency-conflict"
  | "cooldown-active"
  | "dataset-version-mismatch"
  | "idempotency-conflict"
  | "invalid-command"
  | "not-neighbor"
  | "owner-required"
  | "player-team-required"
  | "repository-error"
  | "rule-rejected"
  | "team-not-found"
  | "territory-not-found"
  | "territory-owned"
  | "territory-unowned";

export interface GameCommandError {
  code: GameErrorCode;
  message: string;
  details?: JsonObject;
}

export interface GameCommandSuccess {
  ok: true;
  contextId: string;
  version: number;
  snapshot: GameSnapshot;
  events: GameEvent[];
  auditEntry: GameAuditEntry;
  idempotent: boolean;
}

export interface GameCommandFailure {
  ok: false;
  contextId: string;
  version?: number;
  error: GameCommandError;
  events: [];
  idempotent: false;
}

export type GameCommandResult = GameCommandSuccess | GameCommandFailure;

export interface GameIdempotencyRecord {
  contextId: string;
  idempotencyKey: string;
  commandHash: string;
  result: GameCommandSuccess;
  createdAt: string;
  snapshotVersion: number;
}

export interface GameSnapshotSaveOptions {
  expectedVersion: number;
}

export interface GameSnapshotRepository {
  loadSnapshot(contextId: string): Promise<GameSnapshot | null>;
  saveSnapshot(snapshot: GameSnapshot, options: GameSnapshotSaveOptions): Promise<void>;
  getIdempotencyRecord(
    contextId: string,
    idempotencyKey: string
  ): Promise<GameIdempotencyRecord | null>;
  saveIdempotencyRecord(record: GameIdempotencyRecord): Promise<void>;
}

export interface GameClock {
  now(): Date;
}

export interface GameRandomSource {
  next(): number;
}

export interface GameTerritorySource {
  dataset: TerritoryEngine["dataset"];
  isValidZone(zoneId: string): boolean;
  getZoneLevel(zoneId: string): number;
  zoneNeighbors(zoneId: string, options?: NeighborOptions): string[];
  zoneToParent(zoneId: string): string | null;
  zoneToChildren(zoneId: string): string[];
  getAncestors(zoneId: string): string[];
  getDescendants(zoneId: string): string[];
}

export interface GameHierarchyRuleConfig {
  allowSameLevel?: boolean;
  allowParentChild?: boolean;
}

export interface GameRuleConfig {
  ownershipMode?: GameOwnershipMode;
  requireNeighborForCapture?: boolean;
  allowCaptureFromUnownedSource?: boolean;
  allowCaptureOfUnownedTerritory?: boolean;
  allowUnknownPlayers?: boolean;
  cooldowns?: Partial<Record<GameCommandType, number>>;
  hierarchy?: GameHierarchyRuleConfig;
  neighborOptions?: NeighborOptions;
}

export interface GameActionDescriptor {
  type: GameCommandType;
  contextId: string;
  playerId?: string;
  territoryId?: string;
  sourceTerritoryId?: string;
  owner?: TerritoryOwner;
}

export type ActionRuleDecision =
  | {
      allow: true;
      reason?: string;
    }
  | {
      allow: false;
      code?: GameErrorCode;
      message: string;
      details?: JsonObject;
    };

export interface ActionRuleInput {
  command: GameCommand;
  action: GameActionDescriptor;
  snapshot: GameSnapshot;
  territory: GameTerritorySource;
  now: Date;
  clock: GameClock;
  random: GameRandomSource;
}

export interface ActionRule {
  id: string;
  priority?: number;
  evaluate(input: ActionRuleInput): ActionRuleDecision | Promise<ActionRuleDecision>;
}

export interface CreateGameSnapshotOptions {
  context: GameContext;
  players?: GamePlayer[];
  teams?: GameTeam[];
  now?: Date | string;
  metadata?: JsonObject;
}

export interface GameEngineOptions {
  territory: GameTerritorySource;
  repository?: GameSnapshotRepository;
  context?: Partial<Omit<GameContext, "dataset">> & { dataset?: GameDatasetRef };
  players?: GamePlayer[];
  teams?: GameTeam[];
  rules?: ActionRule[];
  ruleConfig?: GameRuleConfig;
  clock?: GameClock;
  random?: GameRandomSource;
}

export interface GameEngine {
  execute(command: GameCommand): Promise<GameCommandResult>;
  getSnapshot(contextId?: string): Promise<GameSnapshot>;
}

export interface SnapshotMigrationOptions {
  onUnmappedTerritory?: "drop" | "fail" | "keep";
  includeReviewMappings?: boolean;
  now?: Date | string;
}

export interface InMemoryGameRepository extends GameSnapshotRepository {
  getSnapshot(contextId: string): GameSnapshot | null;
  getSnapshots(): GameSnapshot[];
  clear(): void;
}

export type Player = GamePlayer;
export type Team = GameTeam;
export type Claim = TerritoryClaim;
export type Contest = TerritoryContest;
export type Capture = TerritoryCapture;
export type MatchContext = GameContext;
export type WorldContext = GameContext;

const defaultRuleConfig = {
  ownershipMode: "player",
  requireNeighborForCapture: true,
  allowCaptureFromUnownedSource: false,
  allowCaptureOfUnownedTerritory: false,
  allowUnknownPlayers: true,
  hierarchy: {
    allowSameLevel: true,
    allowParentChild: false
  }
} as const satisfies Required<Omit<GameRuleConfig, "cooldowns" | "neighborOptions">>;

export const systemGameClock: GameClock = {
  now() {
    return new Date();
  }
};

export const defaultGameRandomSource: GameRandomSource = {
  next() {
    return Math.random();
  }
};

export class GameConcurrencyError extends Error {
  expectedVersion: number;
  actualVersion: number;

  constructor(expectedVersion: number, actualVersion: number) {
    super(`Expected game snapshot version ${expectedVersion}, received ${actualVersion}.`);
    this.name = "GameConcurrencyError";
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
  }
}

export function isGameConcurrencyError(error: unknown): error is GameConcurrencyError {
  return error instanceof GameConcurrencyError;
}

export function createGameEngine(options: GameEngineOptions): GameEngine {
  const territory = options.territory;
  const repository = options.repository ?? createInMemoryGameRepository();
  const clock = options.clock ?? systemGameClock;
  const random = options.random ?? defaultGameRandomSource;
  const rules = [...(options.rules ?? [])].sort(compareActionRules);
  const config = normalizeRuleConfig(options.ruleConfig);
  const defaultContext = normalizeGameContext(options.context, territory);
  const initialPlayers = options.players ?? [];
  const initialTeams = options.teams ?? [];

  async function getSnapshot(contextId = defaultContext.id): Promise<GameSnapshot> {
    const loaded = await repository.loadSnapshot(contextId);

    if (loaded) {
      return cloneJson(loaded);
    }

    return createGameSnapshot({
      context:
        contextId === defaultContext.id ? defaultContext : { ...defaultContext, id: contextId },
      players: initialPlayers,
      teams: initialTeams,
      now: clock.now()
    });
  }

  async function execute(command: GameCommand): Promise<GameCommandResult> {
    const contextId = command.contextId ?? defaultContext.id;
    const commandHash = stableStringify({ ...command, contextId });

    if (command.idempotencyKey) {
      const idempotencyRecord = await repository.getIdempotencyRecord(
        contextId,
        command.idempotencyKey
      );

      if (idempotencyRecord) {
        if (idempotencyRecord.commandHash !== commandHash) {
          return failure(
            contextId,
            "idempotency-conflict",
            "Idempotency key was already used for a different command."
          );
        }

        return {
          ...cloneJson(idempotencyRecord.result),
          idempotent: true
        };
      }
    }

    const loadedSnapshot = await repository.loadSnapshot(contextId);
    const snapshot =
      loadedSnapshot ??
      createGameSnapshot({
        context:
          contextId === defaultContext.id ? defaultContext : { ...defaultContext, id: contextId },
        players: initialPlayers,
        teams: initialTeams,
        now: clock.now()
      });

    const datasetError = validateSnapshotDataset(snapshot, territory);

    if (datasetError) {
      return failure(
        contextId,
        datasetError.code,
        datasetError.message,
        datasetError.details,
        snapshot.version
      );
    }

    if (command.expectedVersion !== undefined && command.expectedVersion !== snapshot.version) {
      return failure(
        contextId,
        "concurrency-conflict",
        `Expected game snapshot version ${command.expectedVersion}, received ${snapshot.version}.`,
        { expectedVersion: command.expectedVersion, actualVersion: snapshot.version },
        snapshot.version
      );
    }

    const now = clock.now();
    const working = cloneJson(snapshot);
    const action = createResolvedActionDescriptor(command, contextId, working, config);
    const builtinDecision = validateBuiltInRules(command, action, working, territory, config, now);

    if (!builtinDecision.allow) {
      return failure(
        contextId,
        builtinDecision.code ?? "invalid-command",
        builtinDecision.message,
        builtinDecision.details,
        snapshot.version
      );
    }

    for (const rule of rules) {
      const decision = await rule.evaluate({
        command,
        action,
        snapshot: cloneJson(working),
        territory,
        now,
        clock,
        random
      });

      if (!decision.allow) {
        return failure(
          contextId,
          decision.code ?? "rule-rejected",
          decision.message,
          decision.details,
          snapshot.version
        );
      }
    }

    const applied = applyCommand(command, action, working, config, now);
    appendCooldown(command, action, working, config, now, applied.events);
    working.version = snapshot.version + 1;
    working.updatedAt = toIso(now);
    const auditEntry = appendAuditEntry(command, action, working, applied.events, now);

    try {
      await repository.saveSnapshot(working, { expectedVersion: snapshot.version });
    } catch (error) {
      if (isGameConcurrencyError(error)) {
        return failure(
          contextId,
          "concurrency-conflict",
          error.message,
          { expectedVersion: error.expectedVersion, actualVersion: error.actualVersion },
          error.actualVersion
        );
      }

      return failure(
        contextId,
        "repository-error",
        getErrorMessage(error),
        undefined,
        snapshot.version
      );
    }

    const result: GameCommandSuccess = {
      ok: true,
      contextId,
      version: working.version,
      snapshot: cloneJson(working),
      events: cloneJson(applied.events),
      auditEntry: cloneJson(auditEntry),
      idempotent: false
    };

    if (command.idempotencyKey) {
      await repository.saveIdempotencyRecord({
        contextId,
        idempotencyKey: command.idempotencyKey,
        commandHash,
        result: cloneJson(result),
        createdAt: toIso(now),
        snapshotVersion: working.version
      });
    }

    return result;
  }

  return {
    execute,
    getSnapshot
  };
}

export function createGameSnapshot(options: CreateGameSnapshotOptions): GameSnapshot {
  const now = toIso(options.now ?? new Date());
  const players = Object.fromEntries(
    [...(options.players ?? [])].sort(compareById).map((player) => [player.id, cloneJson(player)])
  );
  const teams = Object.fromEntries(
    [...(options.teams ?? [])].sort(compareById).map((team) => [team.id, cloneJson(team)])
  );

  return {
    schemaVersion: TERRITORY_GAME_SNAPSHOT_SCHEMA_VERSION,
    context: cloneJson(options.context),
    version: 0,
    eventSequence: 0,
    commandSequence: 0,
    players,
    teams,
    territories: {},
    claims: [],
    captures: [],
    contests: {},
    scores: {},
    cooldowns: {},
    events: [],
    audit: [],
    updatedAt: now,
    ...(options.metadata ? { metadata: cloneJson(options.metadata) } : {})
  };
}

export function createInMemoryGameRepository(
  snapshots: GameSnapshot[] = []
): InMemoryGameRepository {
  const snapshotsByContext = new Map<string, GameSnapshot>();
  const idempotencyRecords = new Map<string, GameIdempotencyRecord>();

  for (const snapshot of snapshots) {
    snapshotsByContext.set(snapshot.context.id, cloneJson(snapshot));
  }

  return {
    async loadSnapshot(contextId) {
      return cloneNullable(snapshotsByContext.get(contextId) ?? null);
    },

    async saveSnapshot(snapshot, saveOptions) {
      const current = snapshotsByContext.get(snapshot.context.id);
      const actualVersion = current?.version ?? 0;

      if (actualVersion !== saveOptions.expectedVersion) {
        throw new GameConcurrencyError(saveOptions.expectedVersion, actualVersion);
      }

      snapshotsByContext.set(snapshot.context.id, cloneJson(snapshot));
    },

    async getIdempotencyRecord(contextId, idempotencyKey) {
      return cloneNullable(
        idempotencyRecords.get(idempotencyRecordKey(contextId, idempotencyKey)) ?? null
      );
    },

    async saveIdempotencyRecord(record) {
      idempotencyRecords.set(
        idempotencyRecordKey(record.contextId, record.idempotencyKey),
        cloneJson(record)
      );
    },

    getSnapshot(contextId) {
      return cloneNullable(snapshotsByContext.get(contextId) ?? null);
    },

    getSnapshots() {
      return [...snapshotsByContext.values()]
        .sort((left, right) => left.context.id.localeCompare(right.context.id))
        .map((snapshot) => cloneJson(snapshot));
    },

    clear() {
      snapshotsByContext.clear();
      idempotencyRecords.clear();
    }
  };
}

export function serializeGameSnapshot(snapshot: GameSnapshot): string {
  return stableStringify(snapshot);
}

export function deserializeGameSnapshot(serialized: string): GameSnapshot {
  const parsed = JSON.parse(serialized) as unknown;
  assertGameSnapshot(parsed);

  return cloneJson(parsed);
}

export function migrateGameSnapshotTerritories(
  snapshot: GameSnapshot,
  migrationPlan: TerritoryDatasetMigrationPlan,
  options: SnapshotMigrationOptions = {}
): GameSnapshot {
  const validation = validateMigrationPlan(migrationPlan);

  if (!validation.ok) {
    throw new Error(
      `Invalid territory migration plan: ${validation.issues.map((issue) => issue.message).join("; ")}`
    );
  }

  const fromDataset = migrationPlan.fromDataset;
  const toDataset = migrationPlan.toDataset;

  if (snapshot.context.dataset.id !== fromDataset.datasetId) {
    throw new Error(
      `Snapshot dataset '${snapshot.context.dataset.id}' does not match migration source '${fromDataset.datasetId}'.`
    );
  }

  if (snapshot.context.dataset.version !== fromDataset.datasetVersion) {
    throw new Error(
      `Snapshot dataset version '${snapshot.context.dataset.version}' does not match migration source '${fromDataset.datasetVersion}'.`
    );
  }

  if (
    snapshot.context.dataset.geometryHash &&
    snapshot.context.dataset.geometryHash !== fromDataset.geometryHash
  ) {
    throw new Error(
      `Snapshot geometry hash '${snapshot.context.dataset.geometryHash}' does not match migration source '${fromDataset.geometryHash}'.`
    );
  }

  const includeReviewMappings = options.includeReviewMappings === true;
  const onUnmappedTerritory = options.onUnmappedTerritory ?? "fail";
  const mappingByOldId = new Map(
    migrationPlan.mappings
      .filter((mapping) => includeReviewMappings || !mapping.requiresReview)
      .map((mapping) => [mapping.oldId, mapping.newId])
  );
  const migrated = cloneJson(snapshot);
  const migratedAt = toIso(options.now ?? new Date());

  migrated.context = {
    ...migrated.context,
    dataset: {
      id: toDataset.datasetId,
      version: toDataset.datasetVersion,
      geometryHash: toDataset.geometryHash,
      sourceDate: toDataset.sourceDate
    }
  };
  migrated.territories = migrateRecordByTerritoryId(
    migrated.territories,
    mappingByOldId,
    onUnmappedTerritory,
    (state, territoryId) => ({
      ...state,
      territoryId,
      updatedAt: migratedAt
    })
  );
  migrated.scores = migrateRecordByTerritoryId(
    migrated.scores,
    mappingByOldId,
    onUnmappedTerritory,
    (score, territoryId) => ({
      ...score,
      id: score.id === score.territoryId ? territoryId : score.id,
      territoryId,
      updatedAt: migratedAt
    }),
    (score) => score.id
  );
  migrated.cooldowns = migrateCooldowns(migrated.cooldowns, mappingByOldId, onUnmappedTerritory);
  migrated.claims = migrateArrayTerritoryIds(migrated.claims, mappingByOldId, onUnmappedTerritory);
  migrated.captures = migrateCaptures(migrated.captures, mappingByOldId, onUnmappedTerritory);
  migrated.contests = migrateRecordByTerritoryId(
    migrated.contests,
    mappingByOldId,
    onUnmappedTerritory,
    (contest, territoryId) => {
      const sourceTerritoryId = contest.sourceTerritoryId
        ? mapTerritoryId(contest.sourceTerritoryId, mappingByOldId, onUnmappedTerritory)
        : null;
      const { sourceTerritoryId: _sourceTerritoryId, ...contestWithoutSource } = contest;

      return {
        ...contestWithoutSource,
        territoryId,
        ...(sourceTerritoryId ? { sourceTerritoryId } : {})
      };
    },
    (contest) => contest.id
  );
  migrated.events = migrated.events.map((event) =>
    migrateEventTerritoryId(event, mappingByOldId, onUnmappedTerritory)
  );
  migrated.updatedAt = migratedAt;
  migrated.metadata = {
    ...(migrated.metadata ?? {}),
    datasetMigration: {
      fromDatasetVersion: fromDataset.datasetVersion,
      toDatasetVersion: toDataset.datasetVersion,
      migratedAt,
      mappingCount: migrationPlan.mappings.length
    }
  };

  return migrated;
}

function normalizeGameContext(
  input: GameEngineOptions["context"],
  territory: GameTerritorySource
): GameContext {
  const dataset = input?.dataset ?? datasetRefFromTerritory(territory);

  return {
    id: input?.id ?? "default-world",
    kind: input?.kind ?? "world",
    dataset,
    ...(input?.metadata ? { metadata: cloneJson(input.metadata) } : {})
  };
}

function datasetRefFromTerritory(territory: GameTerritorySource): GameDatasetRef {
  const manifest = territory.dataset.manifest;

  return {
    id: manifest.datasetId,
    version: manifest.datasetVersion,
    schemaVersion: manifest.schemaVersion,
    geometryHash: manifest.geometryHash,
    sourceDate: manifest.sourceDate
  };
}

function normalizeRuleConfig(input: GameRuleConfig = {}): Required<GameRuleConfig> {
  return {
    ownershipMode: input.ownershipMode ?? defaultRuleConfig.ownershipMode,
    requireNeighborForCapture:
      input.requireNeighborForCapture ?? defaultRuleConfig.requireNeighborForCapture,
    allowCaptureFromUnownedSource:
      input.allowCaptureFromUnownedSource ?? defaultRuleConfig.allowCaptureFromUnownedSource,
    allowCaptureOfUnownedTerritory:
      input.allowCaptureOfUnownedTerritory ?? defaultRuleConfig.allowCaptureOfUnownedTerritory,
    allowUnknownPlayers: input.allowUnknownPlayers ?? defaultRuleConfig.allowUnknownPlayers,
    cooldowns: input.cooldowns ?? {},
    hierarchy: {
      allowSameLevel: input.hierarchy?.allowSameLevel ?? defaultRuleConfig.hierarchy.allowSameLevel,
      allowParentChild:
        input.hierarchy?.allowParentChild ?? defaultRuleConfig.hierarchy.allowParentChild
    },
    neighborOptions: input.neighborOptions ?? {}
  };
}

function validateSnapshotDataset(
  snapshot: GameSnapshot,
  territory: GameTerritorySource
): GameCommandError | null {
  const current = datasetRefFromTerritory(territory);
  const expected = snapshot.context.dataset;

  if (
    expected.id !== current.id ||
    expected.version !== current.version ||
    (expected.geometryHash &&
      current.geometryHash &&
      expected.geometryHash !== current.geometryHash)
  ) {
    return {
      code: "dataset-version-mismatch",
      message:
        "Game snapshot was created for a different TerritoryKit dataset. Migrate the snapshot or use the original dataset version.",
      details: {
        snapshotDatasetId: expected.id,
        snapshotDatasetVersion: expected.version,
        currentDatasetId: current.id,
        currentDatasetVersion: current.version,
        ...(expected.geometryHash ? { snapshotGeometryHash: expected.geometryHash } : {}),
        ...(current.geometryHash ? { currentGeometryHash: current.geometryHash } : {})
      }
    };
  }

  return null;
}

function validateBuiltInRules(
  command: GameCommand,
  action: GameActionDescriptor,
  snapshot: GameSnapshot,
  territory: GameTerritorySource,
  config: Required<GameRuleConfig>,
  now: Date
): ActionRuleDecision {
  const territoryId = readTerritoryId(command);

  if (territoryId && !territory.isValidZone(territoryId)) {
    return deny(
      "territory-not-found",
      `Territory '${territoryId}' does not exist in the active dataset.`
    );
  }

  if (action.sourceTerritoryId && !territory.isValidZone(action.sourceTerritoryId)) {
    return deny(
      "territory-not-found",
      `Source territory '${action.sourceTerritoryId}' does not exist in the active dataset.`
    );
  }

  const ownerDecision = validateOwner(action.owner, snapshot, config);

  if (!ownerDecision.allow) {
    return ownerDecision;
  }

  const ownerRequiredDecision = validateRequiredOwner(command, action, snapshot, config);

  if (!ownerRequiredDecision.allow) {
    return ownerRequiredDecision;
  }

  const cooldownDecision = validateCooldown(action, snapshot, now);

  if (!cooldownDecision.allow) {
    return cooldownDecision;
  }

  switch (command.type) {
    case "claim-territory": {
      const current = snapshot.territories[command.territoryId];

      if (current?.owner) {
        return deny("territory-owned", `Territory '${command.territoryId}' is already owned.`);
      }

      return allow();
    }

    case "capture-territory": {
      const current = snapshot.territories[command.territoryId];

      if (!current?.owner && !config.allowCaptureOfUnownedTerritory) {
        return deny(
          "territory-unowned",
          `Territory '${command.territoryId}' is unowned; claim it first.`
        );
      }

      if (current?.owner && action.owner && sameOwner(current.owner, action.owner)) {
        return deny(
          "territory-owned",
          `Territory '${command.territoryId}' is already owned by the actor.`
        );
      }

      if (!config.requireNeighborForCapture) {
        return allow();
      }

      if (!action.owner) {
        return deny("owner-required", "Capture commands require a resolved owner.");
      }

      if (
        hasAllowedOwnedActionSource(
          snapshot,
          territory,
          action.owner,
          command.territoryId,
          command.sourceTerritoryId,
          config
        )
      ) {
        return allow();
      }

      return deny(
        "not-neighbor",
        `Capture of '${command.territoryId}' requires an owned neighboring or allowed parent-child source territory.`
      );
    }

    case "start-contest": {
      if (!action.owner) {
        return deny("owner-required", "Contest commands require a resolved owner.");
      }

      if (!config.requireNeighborForCapture) {
        return allow();
      }

      if (
        hasAllowedOwnedActionSource(
          snapshot,
          territory,
          action.owner,
          command.territoryId,
          command.sourceTerritoryId,
          config
        )
      ) {
        return allow();
      }

      return deny(
        "not-neighbor",
        `Contest for '${command.territoryId}' requires an owned neighboring or allowed parent-child source territory.`
      );
    }

    case "set-territory-owner":
    case "adjust-territory-score":
      return allow();
  }
}

function validateRequiredOwner(
  command: GameCommand,
  action: GameActionDescriptor,
  snapshot: GameSnapshot,
  config: Required<GameRuleConfig>
): ActionRuleDecision {
  if (
    command.type !== "claim-territory" &&
    command.type !== "capture-territory" &&
    command.type !== "start-contest"
  ) {
    return allow();
  }

  if (action.owner) {
    return allow();
  }

  if (
    config.ownershipMode === "team" &&
    action.playerId &&
    !snapshot.players[action.playerId]?.teamId
  ) {
    return deny(
      "player-team-required",
      `Player '${action.playerId}' must be assigned to a team before team ownership actions.`
    );
  }

  return deny("owner-required", `Action '${command.type}' requires a territory owner.`);
}

function validateOwner(
  owner: TerritoryOwner | undefined,
  snapshot: GameSnapshot,
  config: Required<GameRuleConfig>
): ActionRuleDecision {
  if (!owner) {
    return allow();
  }

  if (owner.kind === "team" && !snapshot.teams[owner.id]) {
    return deny("team-not-found", `Team '${owner.id}' is not registered in the game snapshot.`);
  }

  if (owner.kind === "player" && !snapshot.players[owner.id] && !config.allowUnknownPlayers) {
    return deny("invalid-command", `Player '${owner.id}' is not registered in the game snapshot.`);
  }

  return allow();
}

function validateCooldown(
  action: GameActionDescriptor,
  snapshot: GameSnapshot,
  now: Date
): ActionRuleDecision {
  if (!action.playerId) {
    return allow();
  }

  const cooldown =
    snapshot.cooldowns[cooldownKey(snapshot.context.id, action.type, action.playerId)];

  if (!cooldown) {
    return allow();
  }

  if (Date.parse(cooldown.expiresAt) <= now.getTime()) {
    return allow();
  }

  return deny(
    "cooldown-active",
    `Action '${action.type}' is on cooldown for player '${action.playerId}'.`,
    {
      expiresAt: cooldown.expiresAt
    }
  );
}

function applyCommand(
  command: GameCommand,
  action: GameActionDescriptor,
  snapshot: GameSnapshot,
  config: Required<GameRuleConfig>,
  now: Date
): { events: GameEvent[] } {
  snapshot.commandSequence += 1;
  const events: GameEvent[] = [];

  switch (command.type) {
    case "claim-territory": {
      const owner = requireResolvedOwner(action);
      const territoryState = setOwner(snapshot, command.territoryId, owner, now);
      const claim: TerritoryClaim = {
        id: `${snapshot.context.id}:claim:${snapshot.commandSequence}`,
        territoryId: command.territoryId,
        owner,
        playerId: command.playerId,
        claimedAt: toIso(now),
        territoryVersion: territoryState.version,
        ...(command.metadata ? { metadata: cloneJson(command.metadata) } : {})
      };
      const event = appendEvent(snapshot, "territory-claimed", now, {
        territoryId: command.territoryId,
        playerId: command.playerId,
        owner,
        payload: { territoryVersion: territoryState.version }
      });
      snapshot.claims.push(claim);
      events.push(event);
      break;
    }

    case "capture-territory": {
      const owner = requireResolvedOwner(action);
      const previousOwner = snapshot.territories[command.territoryId]?.owner;
      const territoryState = setOwner(snapshot, command.territoryId, owner, now);
      const capture: TerritoryCapture = {
        id: `${snapshot.context.id}:capture:${snapshot.commandSequence}`,
        territoryId: command.territoryId,
        ...(command.sourceTerritoryId ? { sourceTerritoryId: command.sourceTerritoryId } : {}),
        ...(previousOwner ? { previousOwner } : {}),
        owner,
        playerId: command.playerId,
        capturedAt: toIso(now),
        territoryVersion: territoryState.version,
        ...(command.metadata ? { metadata: cloneJson(command.metadata) } : {})
      };
      const event = appendEvent(snapshot, "territory-captured", now, {
        territoryId: command.territoryId,
        playerId: command.playerId,
        owner,
        payload: {
          territoryVersion: territoryState.version,
          ...(command.sourceTerritoryId ? { sourceTerritoryId: command.sourceTerritoryId } : {}),
          ...(previousOwner ? { previousOwner: ownerToJson(previousOwner) } : {})
        }
      });
      snapshot.captures.push(capture);
      events.push(event);
      break;
    }

    case "set-territory-owner": {
      const previousOwner = snapshot.territories[command.territoryId]?.owner;
      const territoryState = setOwner(snapshot, command.territoryId, command.owner, now);
      const event = appendEvent(snapshot, "territory-owner-changed", now, {
        territoryId: command.territoryId,
        ...(command.playerId ? { playerId: command.playerId } : {}),
        ...(command.owner ? { owner: command.owner } : {}),
        payload: {
          territoryVersion: territoryState.version,
          ...(previousOwner ? { previousOwner: ownerToJson(previousOwner) } : {}),
          released: command.owner === null
        }
      });
      events.push(event);
      break;
    }

    case "start-contest": {
      const owner = requireResolvedOwner(action);
      const currentOwner = snapshot.territories[command.territoryId]?.owner;
      const contestId =
        command.contestId ?? `${snapshot.context.id}:contest:${snapshot.commandSequence}`;
      const startedAt = toIso(now);
      const endsAt =
        command.durationMs && command.durationMs > 0
          ? toIso(new Date(now.getTime() + command.durationMs))
          : undefined;
      const contest: TerritoryContest = {
        id: contestId,
        territoryId: command.territoryId,
        ...(command.sourceTerritoryId ? { sourceTerritoryId: command.sourceTerritoryId } : {}),
        attacker: owner,
        ...(currentOwner ? { defender: currentOwner } : {}),
        status: "active",
        startedAt,
        ...(endsAt ? { endsAt } : {}),
        ...(command.metadata ? { metadata: cloneJson(command.metadata) } : {})
      };
      snapshot.contests[contestId] = contest;
      events.push(
        appendEvent(snapshot, "contest-started", now, {
          territoryId: command.territoryId,
          playerId: command.playerId,
          owner,
          payload: {
            contestId,
            ...(command.sourceTerritoryId ? { sourceTerritoryId: command.sourceTerritoryId } : {}),
            ...(endsAt ? { endsAt } : {})
          }
        })
      );
      break;
    }

    case "adjust-territory-score": {
      const scoreId = command.scoreId ?? command.territoryId;
      const existing = snapshot.scores[scoreId];
      const owner =
        command.owner ?? existing?.owner ?? snapshot.territories[command.territoryId]?.owner;
      const nextScore: TerritoryScore = {
        id: scoreId,
        territoryId: command.territoryId,
        ...(owner ? { owner } : {}),
        value: (existing?.value ?? 0) + command.delta,
        updatedAt: toIso(now),
        ...(command.metadata
          ? { metadata: cloneJson(command.metadata) }
          : existing?.metadata
            ? { metadata: existing.metadata }
            : {})
      };
      snapshot.scores[scoreId] = nextScore;
      events.push(
        appendEvent(snapshot, "territory-score-changed", now, {
          territoryId: command.territoryId,
          ...(command.playerId ? { playerId: command.playerId } : {}),
          ...(owner ? { owner } : {}),
          payload: {
            scoreId,
            delta: command.delta,
            value: nextScore.value
          }
        })
      );
      break;
    }
  }

  return { events };
}

function appendCooldown(
  command: GameCommand,
  action: GameActionDescriptor,
  snapshot: GameSnapshot,
  config: Required<GameRuleConfig>,
  now: Date,
  events: GameEvent[]
): void {
  if (!action.playerId) {
    return;
  }

  const cooldownMs = config.cooldowns[command.type] ?? 0;

  if (cooldownMs <= 0) {
    return;
  }

  const id = cooldownKey(snapshot.context.id, command.type, action.playerId);
  const expiresAt = new Date(now.getTime() + cooldownMs);
  const cooldown: Cooldown = {
    id,
    actionType: command.type,
    playerId: action.playerId,
    ...(action.territoryId ? { territoryId: action.territoryId } : {}),
    startedAt: toIso(now),
    expiresAt: toIso(expiresAt)
  };
  snapshot.cooldowns[id] = cooldown;
  events.push(
    appendEvent(snapshot, "cooldown-started", now, {
      ...(action.territoryId ? { territoryId: action.territoryId } : {}),
      playerId: action.playerId,
      payload: {
        cooldownId: id,
        actionType: command.type,
        expiresAt: cooldown.expiresAt
      }
    })
  );
}

function appendAuditEntry(
  command: GameCommand,
  action: GameActionDescriptor,
  snapshot: GameSnapshot,
  events: GameEvent[],
  now: Date
): GameAuditEntry {
  const auditEntry: GameAuditEntry = {
    id: `${snapshot.context.id}:audit:${snapshot.commandSequence}`,
    sequence: snapshot.commandSequence,
    contextId: snapshot.context.id,
    commandType: command.type,
    ...(action.playerId ? { playerId: action.playerId } : {}),
    ...(action.territoryId ? { territoryId: action.territoryId } : {}),
    ...(action.sourceTerritoryId ? { sourceTerritoryId: action.sourceTerritoryId } : {}),
    ...(command.idempotencyKey ? { idempotencyKey: command.idempotencyKey } : {}),
    ...(command.expectedVersion !== undefined ? { expectedVersion: command.expectedVersion } : {}),
    snapshotVersion: snapshot.version,
    eventIds: events.map((event) => event.id),
    occurredAt: toIso(now),
    ...(command.metadata ? { metadata: cloneJson(command.metadata) } : {})
  };
  snapshot.audit.push(auditEntry);

  return auditEntry;
}

function resolveCommandOwner(command: GameCommand): TerritoryOwner | undefined {
  switch (command.type) {
    case "claim-territory":
    case "capture-territory":
    case "start-contest":
      return command.owner;
    case "set-territory-owner":
      return command.owner ?? undefined;
    case "adjust-territory-score":
      return command.owner;
  }
}

function requireResolvedOwner(action: GameActionDescriptor): TerritoryOwner {
  if (!action.owner) {
    throw new Error(`Action '${action.type}' does not have a resolved owner.`);
  }

  return action.owner;
}

function resolveDefaultOwner(
  command: GameCommand,
  snapshot: GameSnapshot,
  config: Required<GameRuleConfig>
): TerritoryOwner | undefined {
  const explicitOwner = resolveCommandOwner(command);

  if (explicitOwner) {
    return explicitOwner;
  }

  const playerId = readPlayerId(command);

  if (!playerId) {
    return undefined;
  }

  if (config.ownershipMode === "player") {
    return { kind: "player", id: playerId };
  }

  const player = snapshot.players[playerId];

  if (!player?.teamId) {
    return undefined;
  }

  return { kind: "team", id: player.teamId };
}

function createResolvedActionDescriptor(
  command: GameCommand,
  contextId: string,
  snapshot: GameSnapshot,
  config: Required<GameRuleConfig>
): GameActionDescriptor {
  const playerId = readPlayerId(command);
  const territoryId = readTerritoryId(command);
  const sourceTerritoryId = readSourceTerritoryId(command);
  const owner = resolveDefaultOwner(command, snapshot, config);

  return {
    type: command.type,
    contextId,
    ...(playerId ? { playerId } : {}),
    ...(territoryId ? { territoryId } : {}),
    ...(sourceTerritoryId ? { sourceTerritoryId } : {}),
    ...(owner ? { owner } : {})
  };
}

function hasAllowedOwnedActionSource(
  snapshot: GameSnapshot,
  territory: GameTerritorySource,
  owner: TerritoryOwner,
  targetTerritoryId: string,
  requestedSourceTerritoryId: string | undefined,
  config: Required<GameRuleConfig>
): boolean {
  const ownedSourceIds = Object.values(snapshot.territories)
    .filter((state) => state.owner && sameOwner(state.owner, owner))
    .map((state) => state.territoryId)
    .filter((territoryId) => territoryId !== targetTerritoryId)
    .sort();
  const sourceIds = requestedSourceTerritoryId ? [requestedSourceTerritoryId] : ownedSourceIds;

  for (const sourceId of sourceIds) {
    const sourceState = snapshot.territories[sourceId];

    if (
      !sourceState?.owner &&
      !(config.allowCaptureFromUnownedSource && requestedSourceTerritoryId)
    ) {
      continue;
    }

    if (sourceState?.owner && !sameOwner(sourceState.owner, owner)) {
      continue;
    }

    if (isAllowedActionSource(territory, sourceId, targetTerritoryId, config)) {
      return true;
    }
  }

  return false;
}

function isAllowedActionSource(
  territory: GameTerritorySource,
  sourceTerritoryId: string,
  targetTerritoryId: string,
  config: Required<GameRuleConfig>
): boolean {
  if (!territory.isValidZone(sourceTerritoryId) || !territory.isValidZone(targetTerritoryId)) {
    return false;
  }

  const sourceLevel = territory.getZoneLevel(sourceTerritoryId);
  const targetLevel = territory.getZoneLevel(targetTerritoryId);

  if (sourceLevel === targetLevel && config.hierarchy.allowSameLevel) {
    return territory
      .zoneNeighbors(sourceTerritoryId, config.neighborOptions)
      .includes(targetTerritoryId);
  }

  if (!config.hierarchy.allowParentChild) {
    return false;
  }

  return (
    territory.getAncestors(sourceTerritoryId).includes(targetTerritoryId) ||
    territory.getAncestors(targetTerritoryId).includes(sourceTerritoryId)
  );
}

function setOwner(
  snapshot: GameSnapshot,
  territoryId: string,
  owner: TerritoryOwner | null,
  now: Date
): GameTerritoryState {
  const current = snapshot.territories[territoryId];
  const next: GameTerritoryState = {
    territoryId,
    ...(owner ? { owner } : {}),
    version: (current?.version ?? 0) + 1,
    updatedAt: toIso(now),
    ...(current?.metadata ? { metadata: current.metadata } : {})
  };
  snapshot.territories[territoryId] = next;

  return next;
}

function appendEvent(
  snapshot: GameSnapshot,
  type: GameEventType,
  now: Date,
  input: {
    territoryId?: string;
    playerId?: string;
    owner?: TerritoryOwner;
    payload?: JsonObject;
  }
): GameEvent {
  const sequence = snapshot.eventSequence + 1;
  const event: GameEvent = {
    id: `${snapshot.context.id}:event:${sequence}`,
    sequence,
    type,
    contextId: snapshot.context.id,
    occurredAt: toIso(now),
    ...(input.territoryId ? { territoryId: input.territoryId } : {}),
    ...(input.playerId ? { playerId: input.playerId } : {}),
    ...(input.owner ? { owner: input.owner } : {}),
    ...(input.payload ? { payload: input.payload } : {})
  };
  snapshot.eventSequence = sequence;
  snapshot.events.push(event);

  return event;
}

function readPlayerId(command: GameCommand): string | undefined {
  switch (command.type) {
    case "claim-territory":
    case "capture-territory":
    case "start-contest":
      return command.playerId;
    case "set-territory-owner":
    case "adjust-territory-score":
      return command.playerId;
  }
}

function readTerritoryId(command: GameCommand): string {
  return command.territoryId;
}

function readSourceTerritoryId(command: GameCommand): string | undefined {
  switch (command.type) {
    case "capture-territory":
    case "start-contest":
      return command.sourceTerritoryId;
    case "claim-territory":
    case "set-territory-owner":
    case "adjust-territory-score":
      return undefined;
  }
}

function allow(): ActionRuleDecision {
  return { allow: true };
}

function deny(code: GameErrorCode, message: string, details?: JsonObject): ActionRuleDecision {
  return {
    allow: false,
    code,
    message,
    ...(details ? { details } : {})
  };
}

function failure(
  contextId: string,
  code: GameErrorCode,
  message: string,
  details?: JsonObject,
  version?: number
): GameCommandFailure {
  return {
    ok: false,
    contextId,
    ...(version !== undefined ? { version } : {}),
    error: {
      code,
      message,
      ...(details ? { details } : {})
    },
    events: [],
    idempotent: false
  };
}

function sameOwner(left: TerritoryOwner, right: TerritoryOwner): boolean {
  return left.kind === right.kind && left.id === right.id;
}

function ownerToJson(owner: TerritoryOwner): JsonObject {
  return { kind: owner.kind, id: owner.id };
}

function cooldownKey(contextId: string, actionType: GameCommandType, playerId: string): string {
  return `${contextId}:cooldown:${actionType}:${playerId}`;
}

function idempotencyRecordKey(contextId: string, idempotencyKey: string): string {
  return `${contextId}:${idempotencyKey}`;
}

function compareActionRules(left: ActionRule, right: ActionRule): number {
  return (left.priority ?? 0) - (right.priority ?? 0) || left.id.localeCompare(right.id);
}

function compareById(left: { id: string }, right: { id: string }): number {
  return left.id.localeCompare(right.id);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Repository operation failed.";
}

function toIso(value: Date | string): string {
  return typeof value === "string" ? value : value.toISOString();
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneNullable<T>(value: T | null): T | null {
  return value === null ? null : cloneJson(value);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeStableValue(value));
}

function normalizeStableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeStableValue(entry));
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const normalized: Record<string, unknown> = {};

    for (const key of Object.keys(record).sort()) {
      const next = normalizeStableValue(record[key]);

      if (next !== undefined) {
        normalized[key] = next;
      }
    }

    return normalized;
  }

  if (value === undefined) {
    return undefined;
  }

  return value;
}

function assertGameSnapshot(input: unknown): asserts input is GameSnapshot {
  if (!input || typeof input !== "object") {
    throw new Error("Game snapshot must be an object.");
  }

  const snapshot = input as Partial<GameSnapshot>;

  if (snapshot.schemaVersion !== TERRITORY_GAME_SNAPSHOT_SCHEMA_VERSION) {
    throw new Error(`Unsupported game snapshot schema '${String(snapshot.schemaVersion)}'.`);
  }

  if (!snapshot.context?.id || typeof snapshot.version !== "number") {
    throw new Error("Game snapshot is missing required context or version fields.");
  }
}

function migrateRecordByTerritoryId<T extends { territoryId: string }>(
  record: Record<string, T>,
  mappingByOldId: ReadonlyMap<string, string>,
  onUnmappedTerritory: "drop" | "fail" | "keep",
  update: (value: T, territoryId: string) => T,
  keyForValue: (value: T, territoryId: string) => string = (_value, territoryId) => territoryId
): Record<string, T> {
  const migrated: Record<string, T> = {};

  for (const value of Object.values(record).sort((left, right) =>
    left.territoryId.localeCompare(right.territoryId)
  )) {
    const territoryId = mapTerritoryId(value.territoryId, mappingByOldId, onUnmappedTerritory);

    if (!territoryId) {
      continue;
    }

    const updated = update(value, territoryId);
    const key = keyForValue(updated, territoryId);

    if (migrated[key]) {
      throw new Error(`Multiple migrated records target key '${key}'.`);
    }

    migrated[key] = updated;
  }

  return migrated;
}

function migrateArrayTerritoryIds<T extends { territoryId: string }>(
  values: T[],
  mappingByOldId: ReadonlyMap<string, string>,
  onUnmappedTerritory: "drop" | "fail" | "keep"
): T[] {
  const migrated: T[] = [];

  for (const value of values) {
    const territoryId = mapTerritoryId(value.territoryId, mappingByOldId, onUnmappedTerritory);

    if (!territoryId) {
      continue;
    }

    migrated.push({ ...value, territoryId });
  }

  return migrated;
}

function migrateCooldowns(
  cooldowns: Record<string, Cooldown>,
  mappingByOldId: ReadonlyMap<string, string>,
  onUnmappedTerritory: "drop" | "fail" | "keep"
): Record<string, Cooldown> {
  const migrated: Record<string, Cooldown> = {};

  for (const cooldown of Object.values(cooldowns).sort((left, right) =>
    left.id.localeCompare(right.id)
  )) {
    const territoryId = cooldown.territoryId
      ? mapTerritoryId(cooldown.territoryId, mappingByOldId, onUnmappedTerritory)
      : undefined;

    if (cooldown.territoryId && !territoryId) {
      continue;
    }

    const next: Cooldown = {
      ...cooldown,
      ...(territoryId ? { territoryId } : {})
    };
    migrated[next.id] = next;
  }

  return migrated;
}

function migrateCaptures(
  values: TerritoryCapture[],
  mappingByOldId: ReadonlyMap<string, string>,
  onUnmappedTerritory: "drop" | "fail" | "keep"
): TerritoryCapture[] {
  const migrated: TerritoryCapture[] = [];

  for (const value of values) {
    const territoryId = mapTerritoryId(value.territoryId, mappingByOldId, onUnmappedTerritory);
    const sourceTerritoryId = value.sourceTerritoryId
      ? mapTerritoryId(value.sourceTerritoryId, mappingByOldId, onUnmappedTerritory)
      : null;

    if (!territoryId) {
      continue;
    }

    const { sourceTerritoryId: _sourceTerritoryId, ...captureWithoutSource } = value;

    migrated.push({
      ...captureWithoutSource,
      territoryId,
      ...(sourceTerritoryId ? { sourceTerritoryId } : {})
    });
  }

  return migrated;
}

function migrateEventTerritoryId(
  event: GameEvent,
  mappingByOldId: ReadonlyMap<string, string>,
  onUnmappedTerritory: "drop" | "fail" | "keep"
): GameEvent {
  if (!event.territoryId) {
    return event;
  }

  const territoryId = mapTerritoryId(event.territoryId, mappingByOldId, onUnmappedTerritory);

  if (territoryId) {
    return {
      ...event,
      territoryId
    };
  }

  const { territoryId: _territoryId, ...rest } = event;

  return rest;
}

function mapTerritoryId(
  territoryId: string,
  mappingByOldId: ReadonlyMap<string, string>,
  onUnmappedTerritory: "drop" | "fail" | "keep"
): string | null {
  const mapped = mappingByOldId.get(territoryId);

  if (mapped) {
    return mapped;
  }

  if (onUnmappedTerritory === "keep") {
    return territoryId;
  }

  if (onUnmappedTerritory === "drop") {
    return null;
  }

  throw new Error(`No dataset migration mapping found for territory '${territoryId}'.`);
}
