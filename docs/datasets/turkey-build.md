# Turkey Build

Create a source lock:

```bash
territory country source lock TR \
  --levels ADM0,ADM1,ADM2 \
  --output ./dist/tr/sources.lock.json
```

ADM3 and ADM4 currently resolve as unavailable unless an approved source catalog entry is added.
Province-scoped ADM3 sources use the Turkey ADM3 catalog:

```bash
territory country source lock TR \
  --levels ADM0,ADM1,ADM2,ADM3 \
  --adm3-provinces <approved-province-code> \
  --adm3-catalog datasets/sources/TR/adm3-catalog.json \
  --output ./dist/tr/sources.lock.json
```

Build available artifacts:

```bash
territory country build TR \
  --source-lock ./dist/tr/sources.lock.json \
  --levels ADM0,ADM1,ADM2 \
  --output ./dist/tr/artifact \
  --build-adjacency \
  --build-query-artifacts \
  --build-render-artifacts \
  --build-binary-index \
  --strict \
  --profile \
  --profile-report ./dist/tr/artifact/build-performance-report.json \
  --phase-timeout-ms 300000
```

For partial ADM3 coverage, add `--allow-partial`. The build writes `coverage.json`,
`adm3-quality-gates.json`, and `adm3-source-provenance-report.json` without claiming national ADM3
completion.

The build writes source locks, identity maps, identity diff reports, hierarchy reports, validation
reports, adjacency artifacts, query artifacts, optional MVT render artifacts, and binary spatial
indexes. Large geometry outputs should stay in `dist`, release artifacts, a registry, or operator
data storage, not npm packages.

Profiled ADM0-ADM2 builds also write `build-performance-report.json`, `adjacency-report.json`, and
`render/mvt-policy-report.json`. Use those reports to confirm adjacency candidate filtering, MVT
tile counts by zoom policy, artifact byte totals, phase durations, and checksum validation evidence.

## ADM0-ADM2 Performance Evidence

The 2026-07-24 cached HDX/OCHA COD-AB strict production build completed publish-ready with
`territory country validate ./dist/tr/artifact --strict`.

| Metric           |                          Value |
| ---------------- | -----------------------------: |
| Features         |      1 ADM0, 81 ADM1, 973 ADM2 |
| Total build time |                      153.128 s |
| Longest phase    | 140.117 s adjacency-generation |
| Output bytes     |                    499,409,536 |
| Artifact count   |                          5,107 |
| Peak RSS         |            2,571,943,936 bytes |
| Build errors     |                              0 |

Adjacency stayed bbox-bounded by sibling group:

| Level | Possible pairs | Candidate/tested pairs | Accepted edges |  Duration |
| ----- | -------------: | ---------------------: | -------------: | --------: |
| ADM1  |          2,701 |                    199 |            155 |  10.080 s |
| ADM2  |          6,430 |                  1,872 |          1,473 | 130.025 s |

MVT render output stayed within policy: 5,194 candidate tiles, 5,056 generated tiles, 0 corrupt
tiles, 0 skipped tiles, 7,366,286 total tile bytes, and 389,556 maximum tile bytes. The only MVT
policy warning was the expected ADM0 empty-tile ratio at low zoom.
