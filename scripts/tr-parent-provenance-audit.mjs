import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import {
  inspectTurkeyParentProvenance,
  verifyTurkeyParentProvenance
} from "../packages/generators/dist/turkey-adm3.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUTPUT_DIR = path.join(REPO_ROOT, "reports/tr-adm3/provenance");
const DEFAULT_NATIONAL_CATALOG = path.join(REPO_ROOT, "datasets/sources/TR/national.json");
const DEFAULT_PARENT_DATASET = path.join(REPO_ROOT, "datasets/generated/countries/TR/dataset.json");
const HDX_CACHE_ROOT = path.join(REPO_ROOT, ".territory/cache/sources/hdx-cod-ab");

async function writeTextFile(filePath, contents) {
  const text = contents.endsWith("\n") ? contents : `${contents}\n`;
  await writeFile(filePath, text, "utf8");
}

export function isParentProvenanceAuditCliEntry(argv = process.argv) {
  const entry = argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

function parseAuditCliArgs(argv) {
  const options = {
    outputDir: DEFAULT_OUTPUT_DIR,
    parentDatasetPath: DEFAULT_PARENT_DATASET,
    nationalCatalogPath: DEFAULT_NATIONAL_CATALOG,
    requireAuditByteEvidence: true
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--output-dir") {
      options.outputDir = path.resolve(argv[++index] ?? DEFAULT_OUTPUT_DIR);
    } else if (token === "--parent-dataset") {
      options.parentDatasetPath = path.resolve(argv[++index] ?? DEFAULT_PARENT_DATASET);
    } else if (token === "--national-catalog") {
      options.nationalCatalogPath = path.resolve(argv[++index] ?? DEFAULT_NATIONAL_CATALOG);
    } else if (token === "--allow-missing-byte-evidence") {
      options.requireAuditByteEvidence = false;
    }
  }
  return options;
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

export async function findCachedHdxMember(memberName) {
  const { readdir } = await import("node:fs/promises");
  try {
    for (const entry of await readdir(HDX_CACHE_ROOT, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(HDX_CACHE_ROOT, entry.name, memberName);
      try {
        await stat(candidate);
        return candidate;
      } catch {
        // continue
      }
    }
  } catch {
    return null;
  }
  return null;
}

export async function verifyHdxCatalogMembers(catalog) {
  const members = {};
  const verifiedHdxMembers = {};
  for (const level of ["ADM0", "ADM1", "ADM2"]) {
    const meta = catalog.levels[level];
    const localPath = await findCachedHdxMember(meta.archiveMember);
    if (!localPath) {
      members[level] = { status: "ARTIFACT_NOT_AVAILABLE", archiveMember: meta.archiveMember };
      verifiedHdxMembers[level] = { status: "ARTIFACT_NOT_AVAILABLE" };
      continue;
    }
    const sha256 = await sha256File(localPath);
    const byteSize = (await stat(localPath)).size;
    const status =
      sha256 === meta.sha256 && byteSize === meta.byteSize
        ? "LOCKED_BYTES_VERIFIED"
        : "CHECKSUM_MISMATCH";
    members[level] = {
      status,
      path: path.relative(REPO_ROOT, localPath),
      sha256,
      byteSize,
      expectedSha256: meta.sha256,
      expectedByteSize: meta.byteSize,
      archiveMember: meta.archiveMember,
      actualFeatureCount: meta.actualFeatureCount
    };
    verifiedHdxMembers[level] = { status, sha256, byteSize };
  }
  const archive = {
    status: "ARTIFACT_NOT_AVAILABLE",
    expectedSha256: catalog.sha256,
    expectedByteSize: catalog.byteSize
  };
  return {
    archive,
    members,
    verifiedHdxMembers,
    acquisition: "local-cache-preferring-pinned-members"
  };
}

export async function generateParentProvenanceReports({
  outputDir = DEFAULT_OUTPUT_DIR,
  parentDatasetPath = DEFAULT_PARENT_DATASET,
  nationalCatalogPath = DEFAULT_NATIONAL_CATALOG,
  requireAuditByteEvidence = true
} = {}) {
  const inspectedCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: REPO_ROOT,
    encoding: "utf8"
  }).trim();
  const catalog = JSON.parse(await readFile(nationalCatalogPath, "utf8"));
  const parentDataset = JSON.parse(await readFile(parentDatasetPath, "utf8"));
  const sourceVerification = await verifyHdxCatalogMembers(catalog);

  const hdxMemberPaths = {};
  for (const level of ["ADM0", "ADM1", "ADM2"]) {
    const member = catalog.levels[level]?.archiveMember;
    if (!member) continue;
    const resolved = await findCachedHdxMember(member);
    if (resolved) hdxMemberPaths[level] = resolved;
  }

  const inspection = await inspectTurkeyParentProvenance({
    parentDataset,
    catalog: {
      provider: catalog.provider,
      sourceId: catalog.sourceId,
      sha256: catalog.sha256,
      byteSize: catalog.byteSize,
      levels: catalog.levels
    },
    verifiedHdxMembers: sourceVerification.verifiedHdxMembers,
    ...(Object.keys(hdxMemberPaths).length > 0
      ? {
          hdxMemberPaths,
          readGeoJsonFeatures: async (filePath) => {
            const parsed = JSON.parse(await readFile(filePath, "utf8"));
            return parsed.features ?? [];
          }
        }
      : {})
  });

  const verification = verifyTurkeyParentProvenance(inspection, {
    purpose: "audit-report",
    allowUndeclaredParentSource: false
  });

  const allBytesVerified = Object.values(sourceVerification.verifiedHdxMembers).every(
    (entry) => entry?.status === "LOCKED_BYTES_VERIFIED"
  );
  const auditReportComplete =
    verification.ok &&
    (!requireAuditByteEvidence || allBytesVerified) &&
    inspection.parentInventoryStatus === "COMPLETE";

  await mkdir(outputDir, { recursive: true });

  const parentLineage = {
    schemaVersion: "territorykit-tr-parent-lineage@1",
    inspectedCommit,
    inspectedAt: new Date().toISOString(),
    nationalCatalogPath: path.relative(REPO_ROOT, nationalCatalogPath),
    parentDatasetPath: path.relative(REPO_ROOT, parentDatasetPath),
    parentDatasetVersion: parentDataset.manifest?.datasetVersion ?? null,
    registryDefaultProvider: "geoboundaries",
    countryGeneratorConfigProvider: "hdx-cod-ab",
    nationalBuildDefaultParentDataset: "datasets/generated/countries/TR/dataset.json",
    nationalBuildDefaultSourceMetadata: "datasets/sources/TR/national.json",
    geoBoundariesUpstreamBytesVerified: false,
    evidenceSemantics: {
      providerMetadataAgreement:
        "Zone-level source.provider vs catalog lock only; not polygon byte proof.",
      verifiedSourceBytes: "HDX ZIP members SHA-256 vs national.json when cache present.",
      serializedGeometryEquality: "sha256(JSON.stringify(geometry)); not geographic equivalence.",
      geographicEquivalence: "NOT_ASSESSED"
    },
    cliCallChain: [
      "packages/cli/src/turkey-v2-national.ts: readDataset(DEFAULT_ADM0_ADM2_DATASET)",
      "packages/cli/src/turkey-v2-national.ts: readNationalSource(DEFAULT_NATIONAL_SOURCE)",
      "packages/cli/src/turkey-v2-national.ts: createSourceLockForCli(catalog provider)",
      "packages/generators/src/turkey-v2-national.ts: buildTurkeyV2NationalDataset(adm0Adm2Dataset)"
    ],
    inspection,
    verification,
    auditReportComplete
  };

  await writeTextFile(
    path.join(outputDir, "parent-lineage.json"),
    JSON.stringify(parentLineage, null, 2)
  );
  await writeTextFile(
    path.join(outputDir, "geometry-comparison.json"),
    JSON.stringify(
      {
        schemaVersion: "territorykit-tr-parent-geometry-comparison@2",
        inspectedCommit,
        serializedGeometryHashMethod: "sha256-json-stringify-geometry",
        geographicEquivalenceStatus: "NOT_ASSESSED",
        comparisons: inspection.geometryComparisons
      },
      null,
      2
    )
  );
  await writeTextFile(
    path.join(outputDir, "source-verification.json"),
    JSON.stringify(
      {
        schemaVersion: "territorykit-tr-parent-source-verification@1",
        inspectedCommit,
        catalogProvider: catalog.provider,
        catalogDownloadUrl: catalog.downloadUrl,
        ...sourceVerification
      },
      null,
      2
    )
  );

  const comparisonSummary = inspection.geometryComparisons
    .map(
      (row) =>
        `${row.level}: ${row.exactSerializedGeometryHashMatches}/${row.identityMatchedPairs} serialized-hash matches (identity method ${row.identityMatchMethod})`
    )
    .join("; ");

  const resolution = `# Türkiye ADM0–ADM2 parent provenance resolution

**Inspection commit:** \`${inspectedCommit}\`  
**Classification:** \`${inspection.classification}\`  
**Provider metadata:** \`${inspection.providerMetadataStatus}\`  
**HDX member bytes:** \`${inspection.sourceByteVerificationStatus}\`  
**Serialized geometry:** \`${inspection.serializedGeometryStatus}\`

## Confirmed implementation mismatch

National v2 builds load parent polygons from \`datasets/generated/countries/TR/dataset.json\`, which records \`geoboundaries\` on ADM0–ADM2 zones, while \`datasets/sources/TR/national.json\` and emitted \`source-lock.json\` describe HDX COD-AB checksums. The CLI copies catalog metadata into the lock without verifying that parent polygons were imported from those HDX members.

geoBoundaries upstream archive bytes were **not** independently verified in this repository.

## HDX catalog member bytes (when cached)

Local HDX member caches were checked against \`national.json\` SHA-256 where available (\`${inspection.sourceByteVerificationStatus}\`).

## Serialized geometry comparison (not geographic proof)

${comparisonSummary || "Comparison not run (insufficient member paths)."}

Differing serialized hashes do **not** by themselves prove administrative boundary changes; geographic equivalence was **not** assessed.

## Safe actions in PR #104

- Parent provenance inspection and national \`plan|build\` fail-closed on confirmed provider mismatch.
- \`parentInputDataset\` records observed evidence; optional dev bypass is labeled and forbidden for publish-ready.
- No relabel of geoBoundaries polygons as HDX; no canonical geometry migration.

## Follow-up (separate authorization)

Path A: re-import ADM0–ADM2 from locked HDX members. Path B: realign catalog/registry to geoBoundaries with license attribution. Replay ADM3 clipping impact before promotion.
`;

  await writeTextFile(path.join(outputDir, "resolution.md"), resolution);
  await writeTextFile(
    path.join(outputDir, "README.md"),
    `# TR ADM0–ADM2 provenance evidence

Machine-readable lineage for the national parent polygon mismatch sprint.

| File | Purpose |
| --- | --- |
| [parent-lineage.json](./parent-lineage.json) | Provider inspection, CLI call chain, verification |
| [geometry-comparison.json](./geometry-comparison.json) | HDX member vs parent serialized geometry hashes |
| [source-verification.json](./source-verification.json) | HDX member byte verification against \`national.json\` |
| [resolution.md](./resolution.md) | Human-readable conclusion |

Historical ADM3 audit evidence remains under [../audit/](../audit/).
`
  );

  return { inspection, verification, outputDir, auditReportComplete };
}

async function runCli() {
  const cliOptions = parseAuditCliArgs(process.argv.slice(2));
  const result = await generateParentProvenanceReports(cliOptions);
  const exitOk = result.auditReportComplete;
  console.log(
    JSON.stringify(
      {
        ok: exitOk,
        auditReportComplete: result.auditReportComplete,
        verificationOk: result.verification.ok,
        classification: result.inspection.classification,
        providerMetadataStatus: result.inspection.providerMetadataStatus,
        sourceByteVerificationStatus: result.inspection.sourceByteVerificationStatus,
        outputDir: path.relative(REPO_ROOT, result.outputDir)
      },
      null,
      2
    )
  );
  process.exitCode = exitOk ? 0 : 1;
}

if (isParentProvenanceAuditCliEntry()) {
  runCli().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
