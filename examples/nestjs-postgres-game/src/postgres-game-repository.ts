import {
  GameConcurrencyError,
  deserializeGameSnapshot,
  serializeGameSnapshot
} from "@territory-kit/game";
import type { GameCommandSuccess, GameSnapshotRepository } from "@territory-kit/game";

export const POSTGRES_GAME_SCHEMA_SQL = `
create table if not exists territory_game_snapshots (
  context_id text primary key,
  version integer not null,
  snapshot jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists territory_game_idempotency (
  context_id text not null,
  idempotency_key text not null,
  command_hash text not null,
  result jsonb not null,
  snapshot_version integer not null,
  created_at timestamptz not null default now(),
  primary key (context_id, idempotency_key)
);
`;

export interface SqlQueryResult<TRow> {
  rows: TRow[];
}

export interface SqlExecutor {
  query<TRow>(sql: string, values?: unknown[]): Promise<SqlQueryResult<TRow>>;
}

interface SnapshotRow {
  version: number;
  snapshot: unknown;
}

interface IdempotencyRow {
  context_id: string;
  idempotency_key: string;
  command_hash: string;
  result: unknown;
  snapshot_version: number;
  created_at: string;
}

export function createPostgresGameRepository(sql: SqlExecutor): GameSnapshotRepository {
  return {
    async loadSnapshot(contextId) {
      const result = await sql.query<SnapshotRow>(
        "select version, snapshot from territory_game_snapshots where context_id = $1",
        [contextId]
      );
      const row = result.rows[0];

      if (!row) {
        return null;
      }

      return deserializeGameSnapshot(JSON.stringify(row.snapshot));
    },

    async saveSnapshot(snapshot, options) {
      const serialized = serializeGameSnapshot(snapshot);
      const result = await sql.query<{ version: number }>(
        `
insert into territory_game_snapshots (context_id, version, snapshot)
values ($1, $2, $3::jsonb)
on conflict (context_id) do update
set version = excluded.version,
    snapshot = excluded.snapshot,
    updated_at = now()
where territory_game_snapshots.version = $4
returning version
`,
        [snapshot.context.id, snapshot.version, serialized, options.expectedVersion]
      );

      if (result.rows.length > 0) {
        return;
      }

      const current = await sql.query<{ version: number }>(
        "select version from territory_game_snapshots where context_id = $1",
        [snapshot.context.id]
      );

      throw new GameConcurrencyError(options.expectedVersion, current.rows[0]?.version ?? 0);
    },

    async getIdempotencyRecord(contextId, idempotencyKey) {
      const result = await sql.query<IdempotencyRow>(
        `
select context_id, idempotency_key, command_hash, result, snapshot_version, created_at
from territory_game_idempotency
where context_id = $1 and idempotency_key = $2
`,
        [contextId, idempotencyKey]
      );
      const row = result.rows[0];

      if (!row) {
        return null;
      }

      return {
        contextId: row.context_id,
        idempotencyKey: row.idempotency_key,
        commandHash: row.command_hash,
        result: parseCommandSuccess(row.result),
        createdAt: row.created_at,
        snapshotVersion: row.snapshot_version
      };
    },

    async saveIdempotencyRecord(record) {
      await sql.query(
        `
insert into territory_game_idempotency (
  context_id,
  idempotency_key,
  command_hash,
  result,
  snapshot_version,
  created_at
)
values ($1, $2, $3, $4::jsonb, $5, $6)
on conflict (context_id, idempotency_key) do nothing
`,
        [
          record.contextId,
          record.idempotencyKey,
          record.commandHash,
          JSON.stringify(record.result),
          record.snapshotVersion,
          record.createdAt
        ]
      );
    }
  };
}

function parseCommandSuccess(input: unknown): GameCommandSuccess {
  const parsed = input as Partial<GameCommandSuccess>;

  if (parsed.ok !== true || !parsed.snapshot) {
    throw new Error("Stored idempotency result is not a successful game command result.");
  }

  return {
    ...parsed,
    snapshot: deserializeGameSnapshot(JSON.stringify(parsed.snapshot))
  } as GameCommandSuccess;
}

export function createNestProvider(sql: SqlExecutor) {
  return {
    provide: "TERRITORY_GAME_REPOSITORY",
    useValue: createPostgresGameRepository(sql)
  };
}
