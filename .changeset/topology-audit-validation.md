---
"@territory-kit/generators": patch
"@territory-kit/cli": patch
---

Harden topology-safe simplification reporting with report v2. The topology audit now verifies
actual shared-boundary relationships across simplified output geometries instead of treating shared
segment reduction as mismatches, includes geometry validation summaries and structured issues, and
marks the overall report failed when any requested tier fails. The CLI now returns exit code 1 for
completed simplification runs whose topology or geometry quality audit fails while preserving the
diagnostic report.
