# Game Concurrency

`@territory-kit/game` uses snapshot-level optimistic concurrency. Every successful command increments
`GameSnapshot.version`; callers pass the version they read as `expectedVersion`.

```ts
const result = await gameEngine.execute({
  type: "claim-territory",
  playerId,
  territoryId,
  expectedVersion: snapshot.version,
  idempotencyKey: requestId
});
```

If another command commits first, the repository throws `GameConcurrencyError` and the engine returns
`{ ok: false, error: { code: "concurrency-conflict" } }`.

## Idempotency

Use `idempotencyKey` for commands that may be retried by HTTP clients, queues, or mobile clients.
The engine checks the idempotency record before the expected-version check:

- same key and same command hash returns the original success result
- same key and different command returns `idempotency-conflict`
- retries do not append duplicate claims, captures, events, cooldowns, or audit entries

## Repository Requirements

A production repository should perform these operations atomically:

1. lock or compare the current snapshot row by context ID
2. reject when `current.version !== expectedVersion`
3. write the new snapshot
4. write the idempotency result
5. commit the transaction

For high-throughput multiplayer, add an external command queue, shard contexts by match/world ID,
and publish committed events to the realtime transport after the database commit.
