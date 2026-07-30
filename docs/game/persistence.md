# Game Persistence

The game package ships a generic repository interface and an in-memory implementation for tests,
single-process demos, and examples.

```ts
interface GameSnapshotRepository {
  loadSnapshot(contextId: string): Promise<GameSnapshot | null>;
  saveSnapshot(snapshot: GameSnapshot, options: { expectedVersion: number }): Promise<void>;
  getIdempotencyRecord(
    contextId: string,
    idempotencyKey: string
  ): Promise<GameIdempotencyRecord | null>;
  saveIdempotencyRecord(record: GameIdempotencyRecord): Promise<void>;
}
```

Repositories own durable storage and must enforce the optimistic lock in `saveSnapshot`.
Production repositories should store the snapshot write and idempotency record in the same database
transaction.

## In-Memory

```ts
const repository = createInMemoryGameRepository();
```

The in-memory repository clones snapshots on read/write and throws `GameConcurrencyError` when the
stored version differs from `expectedVersion`.

## Postgres/NestJS Example

`examples/nestjs-postgres-game` contains a framework-light Postgres JSONB repository and a Nest-style
provider helper:

```ts
import { createPostgresGameRepository } from "@territory-kit/example-nestjs-postgres-game";

const repository = createPostgresGameRepository(sqlExecutor);
```

The example uses an injected `SqlExecutor` instead of `pg`, Prisma, TypeORM, or NestJS imports.
Applications can adapt it to their database client while keeping `@territory-kit/game` dependency
free from backend frameworks.

## Snapshot Storage

Snapshots are JSON DTOs. Use:

```ts
const serialized = serializeGameSnapshot(snapshot);
const restored = deserializeGameSnapshot(serialized);
```

Store `context.dataset.id`, `context.dataset.version`, and `context.dataset.geometryHash` with every
snapshot so runtime execution can reject accidental dataset mismatches.
