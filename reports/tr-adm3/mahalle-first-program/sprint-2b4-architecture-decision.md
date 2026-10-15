# Sprint 2B.4 — Hybrid mahalle partitioning architecture

## Context

Sprint 2B.3 closed **INCONCLUSIVE**: impl-rev3 improved seed coverage (0.5352) but weighted barrier alignment remained **0.7521** vs v1.7 replay **0.8907**, with **+17** ADM3 zones vs v1.7. Further watershed threshold tuning is out of scope.

## Alternative A — Barrier-preserved hybrid (impl-rev4)

**Idea:** Keep v1.7 area-target merge groups as anchors; run seed watershed inside each group; **collapse** inter-seed splits that are separated only by **weak** barriers (<0.75 strength); retain splits when a **strong** road/rail/water barrier separates seeds.

**Implementation:** `mergeV17AnchoredWatershedFaceGroups` + `buildTurkeyNetworkFaceV17MergeLeader` in `turkey-seed-watershed.ts`; opt-in via `impl-rev4` / `buildTurkeySmartFallbackV2PilotRev4HybridWithAdjacency`.

| Dimension            | Assessment                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------- |
| Technical cost       | Medium — localized to network face merge stage; rev1–rev3 preserved                         |
| Source compatibility | Same pinned OSM + seeds as 2B.3                                                             |
| Geometry quality     | Targets fewer unsupported internal edges than rev3 (see boundary inventory)                 |
| Migration            | New stable IDs if zone count changes; rc.8/v1.7 IDs still not retained without approved map |

**Fatih measurement (this run):** weighted=0.5047, seedCoverage=0.2394, zones=48.

## Alternative B — Gameplay zone vs settlement identity

**Idea:** Keep **v1.7 replay polygons and stable IDs**; attach 0..N mahalle seeds per zone as semantic metadata; **do not** auto-name when `AMBIGUOUS_REVIEW_REQUIRED`.

**Fatih preview:** 15 ambiguous zones, 71 distinct seed names represented geometrically inside v1.7 zones (no new polygons).

| Dimension            | Assessment                                                             |
| -------------------- | ---------------------------------------------------------------------- |
| Technical cost       | Low — schema/reporting + consumer contract                             |
| Source compatibility | Full — no fabricated boundaries                                        |
| Geometry quality     | Identical to v1.7 replay (barrier alignment preserved)                 |
| Migration            | Minimal if gameplay IDs unchanged; semantic layer versioned separately |

## Independent boundary QA (v1.7 replay vs impl-rev3 reference)

| Metric                             |    Value |
| ---------------------------------- | -------: |
| Shared internal boundary (m)       | 26752.39 |
| v1.7-only internal boundary (m)    | 31959.91 |
| rev3-only internal boundary (m)    | 41543.23 |
| rev3-only share of unique internal |   0.4144 |

`inspectTurkeySmartBoundaryAlignment` realBarrierRatio: v1.7=null, rev3=null, rev4=null.

## Pathology / seed semantics (from 2B.3 root cause, verified on pinned inputs)

- **+17 zones:** rev3-only internal boundary length (41543.23 m unique-weighted) vs v1.7-only lost (31959.91 m).
- **47 represented vs 38 seed-named:** watershed represents more seed labels than receive `locality-seed` polygon names (multi-face components + naming cap).
- **25 SPIKE findings (rev3):** {"totalFindings":25,"byKind":{"SPIKE":25}}

## Recommendation

- If Alternative A Fatih gates fail → **technical NO-GO** for national hybrid watershed; pursue **Alternative B** for mahalle semantics without geometry churn, or acquire licensed official mahalle polygons.
- Do not relax quality gates to force GO.

## Locks

- Parent ADM2: `tr:adm2:54988432b39641834885080`
- rev3 reference output: `.territory/mahalle-first-pilot/fatih-v2-impl-rev3` (read-only)
- Hybrid output: `.territory/mahalle-first-pilot/fatih-v2-impl-rev4-hybrid`
