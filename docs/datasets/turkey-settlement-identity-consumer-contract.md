# Turkey settlement identity — consumer contract

## Scope

Read-only semantic association between **pinned gameplay ADM3 zones** and **OSM locality seeds**. This is not an official mahalle boundary dataset.

## Entry points

| API                               | Package                  | Use                                  |
| --------------------------------- | ------------------------ | ------------------------------------ |
| `loadSettlementIdentityConsumer`  | `@territory-kit/core`    | Fail-closed load + validate + lookup |
| `createSettlementIdentityLookup`  | `@territory-kit/core`    | Lookup only after validation         |
| `validateSettlementIdentityLayer` | `@territory-kit/dataset` | Pin and gameplay consistency checks  |

Do **not** use legacy `TrSettlementAssociation` (PR #118 prototype).

## Required pins (per district)

Load with `SettlementIdentityPinExpectations` matching committed `*-consumer-pin.json`:

- `parentAdm2Id`
- `gameplayDatasetVersion` (rc.8, e.g. `2.1.0-rc.8`)
- `zoneIdSetSha256`
- `geometryHashSetSha256`
- `identityLayerContentChecksum`
- `expectedOsmSnapshotChecksum` when snapshot bytes are pinned

Missing OSM source-lock: record `SOURCE_LOCK_MISSING`; do not mark distribution-ready.

## Name and display semantics

- `verificationState: locality-seed` — point seed only, not a verified administrative polygon.
- `autoDisplayNameAllowed: false` unless explicit human review evidence exists on the association.
- `consumerNameSemantics: seed-locality-label` — label only; not a legal boundary claim.

## Gameplay invariants

Identity layer artifacts must not alter:

- Zone count, zone IDs, geometry hashes, parent links, adjacency, or MVT feature identity.

## Istanbul pilot artifacts

Under `reports/tr-adm3/mahalle-identity-layer/`:

- `{slug}-identity-layer.json` — canonical layer document
- `{slug}-consumer-pin.json` — consumer pin bundle
- `istanbul-pilot-matrix.json` — eight-district readiness matrix

## Rush&Claim

Integrate semantics alongside existing district shard / MVT contracts per `rushclaim-sprint-4-handoff.md`. Do not derive ownership geometry from seed associations.
