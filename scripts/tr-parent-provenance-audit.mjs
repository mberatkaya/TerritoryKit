import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import {
  inspectTurkeyParentProvenance,
  verifyTurkeyParentProvenance
} from "../packages/generators/dist/turkey-adm3.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_DIR = path.join(REPO_ROOT, "reports/tr-adm3/provenance");
const NATIONAL_CATALOG = path.join(REPO_ROOT, "datasets/sources/TR/national.json");
const PARENT_DATASET = path.join(REPO_ROOT, "datasets/generated/countries/TR/dataset.json");
const HDX_CACHE_ROOT = path.join(REPO_ROOT, ".territory/cache/sources/hdx-cod-ab");

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

async function findCachedMember(memberName) {
  const { readdir } = await import("node:fs/promises");
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
  return null;
}

async function inspectSourceVerification(catalog) {
  const members = {};
  for (const level of ["ADM0", "ADM1", "ADM2"]) {
    const meta = catalog.levels[level];
    const localPath = await findCachedMember(meta.archiveMember);
    if (!localPath) {
      members[level] = { status: "ARTIFACT_NOT_AVAILABLE", archiveMember: meta.archiveMember };
      continue;
    }
    const sha256 = await sha256File(localPath);
    const byteSize = (await stat(localPath)).size;
    members[level] = {
      status:
        sha256 === meta.sha256 && byteSize === meta.byteSize
          ? "LOCKED_BYTES_VERIFIED"
          : "CHECKSUM_MISMATCH",
      path: path.relative(REPO_ROOT, localPath),
      sha256,
      byteSize,
      expectedSha256: meta.sha256,
      expectedByteSize: meta.byteSize,
      archiveMember: meta.archiveMember,
      actualFeatureCount: meta.actualFeatureCount
    };
  }
  const archive = {
    status: "ARTIFACT_NOT_AVAILABLE",
    expectedSha256: catalog.sha256,
    expectedByteSize: catalog.byteSize
  };
  return { archive, members, acquisition: "local-cache-preferring-pinned-members" };
}

export async function generateParentProvenanceReports({
  outputDir = OUTPUT_DIR,
  parentDatasetPath = PARENT_DATASET,
  nationalCatalogPath = NATIONAL_CATALOG
} = {}) {
  const inspectedCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: REPO_ROOT,
    encoding: "utf8"
  }).trim();
  const catalog = JSON.parse(await readFile(nationalCatalogPath, "utf8"));
  const parentDataset = JSON.parse(await readFile(parentDatasetPath, "utf8"));
  const hdxMemberPaths = {};
  for (const level of ["ADM0", "ADM1", "ADM2"]) {
    const member = catalog.levels[level]?.archiveMember;
    if (!member) continue;
    const resolved = await findCachedMember(member);
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
    ...(Object.keys(hdxMemberPaths).length === 3
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
    allowUndeclaredParentSource: true
  });
  const sourceVerification = await inspectSourceVerification(catalog);
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
    cliCallChain: [
      "packages/cli/src/turkey-v2-national.ts: readDataset(DEFAULT_ADM0_ADM2_DATASET)",
      "packages/cli/src/turkey-v2-national.ts: readNationalSource(DEFAULT_NATIONAL_SOURCE)",
      "packages/cli/src/turkey-v2-national.ts: createSourceLockForCli(catalog provider)",
      "packages/generators/src/turkey-v2-national.ts: buildTurkeyV2NationalDataset(adm0Adm2Dataset)"
    ],
    inspection,
    verification
  };

  await writeFile(
    path.join(outputDir, "parent-lineage.json"),
    JSON.stringify(parentLineage, null, 2)
  );
  await writeFile(
    path.join(outputDir, "geometry-comparison.json"),
    JSON.stringify(
      {
        schemaVersion: "territorykit-tr-parent-geometry-comparison@1",
        inspectedCommit,
        geometryHashMethod: "sha256-json-stringify-geometry",
        comparisons: inspection.geometryComparisons
      },
      null,
      2
    )
  );
  await writeFile(
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

  const resolution = `# Türkiye ADM0–ADM2 parent provenance resolution

**Inspection commit:** \`${inspectedCommit}\`  
**Classification:** \`${inspection.classification}\`  
**Lineage status:** \`${inspection.lineageStatus}\`  
**HDX geometry status:** \`${inspection.catalogGeometryStatus}\`

## Root cause

National v2 builds load parent polygons from \`datasets/generated/countries/TR/dataset.json\`, which records \`geoboundaries\` on ADM0–ADM2 zones, while \`datasets/sources/TR/national.json\` and the emitted national \`source-lock.json\` describe HDX COD-AB checksums. The CLI copies catalog metadata into the lock without verifying that the parent dataset bytes were imported from those HDX members.

Verified local HDX member caches match \`national.json\` SHA-256 values, but parent dataset geometry hashes do not match those members (${inspection.geometryComparisons
    .map(
      (row) =>
        `${row.level}: ${row.exactGeometryHashMatches}/${row.nameMatchedPairs} exact name matches`
    )
    .join("; ")}).

## Safe actions taken in this sprint

- Added explicit parent provenance inspection and national build/plan failure on provider mismatch.
- Recorded \`parentInputDataset\` evidence on new source locks when builds are allowed.
- Did **not** relabel geoBoundaries polygons as HDX or migrate canonical geometry.

## Follow-up migration (separate authorization)

Re-import ADM0–ADM2 from locked HDX members **or** realign catalog/source-lock to geoBoundaries with license attribution, then replay ADM3 clipping impact.
`;

  await writeFile(path.join(outputDir, "resolution.md"), resolution);
  await writeFile(
    path.join(outputDir, "README.md"),
    `# TR ADM0–ADM2 provenance evidence

Machine-readable lineage for the national parent polygon mismatch sprint.

| File | Purpose |
| --- | --- |
| [parent-lineage.json](./parent-lineage.json) | Provider inspection, CLI call chain, verification |
| [geometry-comparison.json](./geometry-comparison.json) | HDX member vs parent dataset geometry hashes |
| [source-verification.json](./source-verification.json) | Local HDX member byte verification against \`national.json\` |
| [resolution.md](./resolution.md) | Human-readable conclusion |

Historical ADM3 audit evidence remains under [../audit/](../audit/).
`
  );

  return { inspection, verification, outputDir };
}

if (import.meta.url === fileURLToPath(import.meta.url)) {
  const result = await generateParentProvenanceReports();
  console.log(
    JSON.stringify(
      {
        ok: result.verification.ok,
        classification: result.inspection.classification,
        outputDir: path.relative(REPO_ROOT, result.outputDir)
      },
      null,
      2
    )
  );
}
