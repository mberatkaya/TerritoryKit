#!/usr/bin/env node
/**
 * Sprint 2C — Fatih mahalle identity layer (Alternative B) from pinned rc.8 gameplay + OSM seeds.
 */
import { writeReportJson, writeReportMarkdown } from "./lib/write-report-json.mjs";
import { buildMahalleIdentityDistrictReports } from "./lib/tr-mahalle-identity-layer-district.mjs";
import { pilotBySlug } from "./lib/tr-mahalle-identity-istanbul-pilots.mjs";

const REPO_ROOT = process.cwd();
const REPORT_ROOT = "reports/tr-adm3/mahalle-identity-layer";

async function main() {
  const pilot = pilotBySlug("fatih");
  const result = await buildMahalleIdentityDistrictReports({
    repoRoot: REPO_ROOT,
    pilot,
    reportRoot: REPORT_ROOT
  });

  if (!result.ok) {
    console.error(JSON.stringify(result, null, 2));
    process.exitCode = 1;
    return;
  }

  const { metrics, immutability, layer, lookupSmoke } = result;
  const generatedAt = new Date().toISOString();

  const decision = {
    schemaVersion: "territorykit-tr-mahalle-identity-sprint-2c-decision@1",
    generatedAt,
    district: "Fatih",
    parentAdm2Id: result.parentAdm2Id,
    technicalPilotDecision: "GO_WITH_REVIEW",
    productionReleaseReadiness: "NO_GO",
    rationale: [
      "Gameplay rc.8 zone IDs and geometry hashes unchanged; identity layer is versioned separately.",
      "Seed-only semantics explicitly non-authoritative; no official mahalle polygons promoted.",
      `${metrics.ambiguousZoneCount} ambiguous zones require human review before auto display naming.`,
      "Official polygon acquisition remains the long-term precedence path."
    ],
    metrics,
    immutability: {
      determinismVerified: immutability.determinismVerified,
      zoneIdSetSha256: immutability.zoneIdSetSha256,
      geometryHashSetSha256: immutability.geometryHashSetSha256,
      identityLayerContentChecksum: layer.contentChecksum
    },
    consumerContract: {
      lookup: "loadSettlementIdentityConsumer (@territory-kit/core)",
      autoDisplayNameAllowedOnlyWhen:
        "never for automatic seed associations; use consumerNameSemantics seed-locality-label with verificationState locality-seed",
      reviewApprovalRequires: "explicit human review evidence (association method reviewed)"
    },
    nextIstanbulPilots: [
      {
        district: "Kadıköy",
        note: "Official acquisition BLOCKED_BY_SOURCE; OSM seed semantics only."
      },
      {
        district: "Eyüpsultan",
        note: "Sparse barrier network — expect lower seed coverage; identity layer still useful."
      },
      {
        district: "Adalar",
        note: "Coastline/multipolygon edge cases — validate boundary-point policy on islands."
      }
    ],
    lookupSmoke
  };

  await writeReportMarkdown(
    `${REPORT_ROOT}/sprint-2c-decision.md`,
    `# Sprint 2C — Fatih mahalle identity layer

## Decision

- **Technical pilot:** ${decision.technicalPilotDecision}
- **Production release:** ${decision.productionReleaseReadiness}

## Fatih metrics

| Metric | Value |
| --- | ---: |
| Gameplay zones | ${metrics.zoneCount} |
| Ambiguous zones | ${metrics.ambiguousZoneCount} |
| Single-seed zones | ${metrics.singleSeedZoneCount} |
| Unseeded zones | ${metrics.unseededZoneCount} |
| Distinct seeds represented | ${metrics.distinctSeedsRepresented} |

## Immutability

- Zone ID set SHA-256: \`${immutability.zoneIdSetSha256}\`
- Geometry hash set SHA-256: \`${immutability.geometryHashSetSha256}\`
- Identity layer checksum: \`${layer.contentChecksum}\`
- Determinism verified: **${immutability.determinismVerified}**

## Consumer contract

Use \`loadSettlementIdentityConsumer\` from \`@territory-kit/core\` with artifacts under \`reports/tr-adm3/mahalle-identity-layer/\`. Do not treat gameplay polygon edges as official mahalle boundaries.

## Map preview

Serve \`examples/web-maplibre-turkey\` with \`MAHALLE_IDENTITY_PREVIEW=1\` or open the mahalle identity preview entry.
`
  );

  await writeReportJson(`${REPORT_ROOT}/sprint-2c-decision.json`, decision);

  console.log(
    JSON.stringify(
      {
        ok: true,
        reportRoot: REPORT_ROOT,
        metrics,
        contentChecksum: layer.contentChecksum,
        determinismVerified: immutability.determinismVerified
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
