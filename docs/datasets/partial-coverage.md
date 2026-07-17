# Partial Coverage

Lower administrative data is often incomplete, license-restricted, or source-specific. TerritoryKit
represents this directly instead of substituting broader geometry.

Coverage statuses include `verified`, `generated`, `generated-with-warnings`, `partial`,
`source-unavailable`, `licence-restricted`, `semantic-review-required`, and `deprecated`.

Use `partial` when a real source covers only part of a country, for example a single city fixture or
pilot area. Use `source-unavailable` when no redistributable source manifest is available for the
requested country and level.

Clients that opt into fallback should display the resolved level explicitly. For example, a request
for `TR ADM3` may render `ADM2` with reason `requested-level-unavailable`.
