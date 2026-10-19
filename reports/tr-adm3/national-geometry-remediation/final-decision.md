# National geometry remediation — final decision (rc.8)

**Branch:** feat/tr-national-geometry-remediation  
**Inspected commit:** `893480e78e82da8d6f6f234ebd6adaaa26599888`  
**rc.7 bytes:** `.territory/sprint-6/final/candidate` (unchanged)  
**rc.8 bytes:** `.territory/national-geometry-remediation/candidate-rc8-impl-rev1` (unchanged)

## MERGE recommendation

**MERGE GO** (technical, PR #111 — not production publish)

## ADM3 independent geometry validation (rc.8)

| Metric                             | Value |
| ---------------------------------- | ----- |
| ADM3 zones validated               | 20392 |
| Districts with geometry errors     | 0     |
| Sibling overlap errors (aggregate) | 0     |
| Parent containment errors          | 0     |
| Invalid polygon errors             | 0     |

### Three former blocker districts

- **Ağrı merkez** (tr:adm2:54988432b81567150601582): sibling overlaps=0, parent containment=0, invalid polygon=0
- **İskenderun** (tr:adm2:54988432b95277821649488): sibling overlaps=0, parent containment=0, invalid polygon=0
- **Erbaa** (tr:adm2:54988432b28913521474336): sibling overlaps=0, parent containment=0, invalid polygon=0

## Smart coverage quality delta (same methodology as audit)

| Metric                                          | rc.7 | rc.8 | Delta |
| ----------------------------------------------- | ---: | ---: | ----: |
| Low-confidence districts                        |  631 |  631 |     0 |
| Realism warning districts                       |  577 |  577 |     0 |
| unsupportedStraightThresholdViolations (totals) |  577 |  577 |     0 |

Low-confidence: improved=0, unchanged=973, regressed=0.

Realism warnings: improved=0, unchanged=973, regressed=0.

## Stable ID / migration

- Canonical geometry hash changed: **true**
- Zone ID drift (rc.7 only / rc.8 only): **0 / 0**
- Parent ID changes: **0**
- Geometry hash changes (zones): **34** (İskenderun 23, Erbaa 7, Ağrı merkez 4)
- migration-plan.json: **not authoritative** for rc.7→rc.8 — 20 392×`added` (no `--migration-baseline`); use `stable-id-diff.json` for ownership.

## Geometry remediation gain (rc.8 vs rc.7)

- rc.7 geometry-blocked districts (sibling overlap): **3** → rc.8 independent validator district errors: **0**
- Low-confidence / realism warning districts: **631 / 577** unchanged (out of PR scope)

## MVT / shards (rc.8)

- MVT tiles: **18856**
- render manifest `sourceLayer`: **territory_adm3**
- `delivery-manifest.json`: **absent** (rc.7 had delivery-manifest artifacts; runtime consumer manifest still a separate delivery step)
- Sampled tiles: parentAdm2Id + `territory_adm3` layer **5/5 PASS**
- fullMvtDeliveryReady (sample gate): **true**

## publishReady=false (not district incompleteness)

- buildMode: **partial**
- publishReady gate failures: **buildMode, nationalCompleteness**
- 973 districts built: **true**

## Explicit non-actions

No production promotion, npm publish, CDN deploy, or Rush&Claim migration executed.
