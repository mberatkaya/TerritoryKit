# Country Hierarchy

Country builds resolve ADM1 parents under ADM0 and ADM2 parents under ADM1. The result is written to
`hierarchy-report.json` and summarized in the country manifest.

## Resolution Order

1. Match explicit source parent ids such as `parentShapeID` or `shapeParentID`.
2. Match configured official parent code properties.
3. Use bbox prefiltering plus exact polygon containment for spatial fallback.

Explicit parent matches are still checked with geometry containment. If a declared parent does not
cover the child polygon, the build records `PARENT_CONTAINMENT_FAILED`.

## Publish Gates

The default pilot policy rejects:

- unresolved parents
- ambiguous spatial parent candidates
- explicit parent containment failures

The combined `dataset.json` keeps parent and child links. Per-level datasets are standalone valid
artifacts, so parent links that point to another level are not duplicated inside `levels/<ADM>`.
