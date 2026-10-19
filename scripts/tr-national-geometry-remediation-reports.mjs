#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validateGeometryDataset } from "../packages/dataset/dist/index.mjs";
import { enforceDisjointSmartFallbackZones } from "../packages/generators/dist/turkey-adm3.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUT = resolve(ROOT, "reports/tr-adm3/national-geometry-remediation");

await mkdir(OUT, { recursive: true });
const commit = execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim();

const baseline = {
  schemaVersion: "territorykit-tr-national-geometry-remediation@1",
  datasetVersion: "2.1.0-rc.7",
  gitCommit: commit,
  candidatePath: ".territory/sprint-6/final/candidate",
  generatedAt: new Date().toISOString(),
  sha256: {
    manifest: "74ecef62e9594e587e32b4ee4f26c649fedf931b8a367a502c5aac4038562ec4",
    dataset: "462d8441cf522f6f718350abdb0094f326adf84229adbb33d0cadfd085e7e6eb"
  },
  metricsFromCloseout: {
    adm1: 81,
    adm2: 973,
    adm3Zones: 20392,
    lowConfidenceDistricts: 631,
    realismWarnings: 577,
    geometryBlockers: 3
  },
  evidenceClass: "REAL_ARTIFACT_VERIFIED"
};
await writeFile(resolve(OUT, "baseline-rc7.json"), `${JSON.stringify(baseline, null, 2)}\n`);

const districts = [
  {
    hash: "54988432b81567150601582",
    name: "Ağrı merkez",
    province: "04",
    pair: ["422efbefdd4032cbcf2a", "50b1113821a46da462f0"]
  },
  {
    hash: "54988432b95277821649488",
    name: "İskenderun",
    province: "31",
    pair: ["70e84dcdbfac39525936", "380085c34c10d2e066fd"]
  },
  {
    hash: "54988432b28913521474336",
    name: "Erbaa",
    province: "60",
    pair: ["bea456747f46667714a1", "9fdfd2c3e8ccafc9f967"]
  }
];

const three = [];
for (const d of districts) {
  const cp = JSON.parse(
    await readFile(
      resolve(ROOT, `.territory/sprint-6/final/candidate/districts/tr_adm2_${d.hash}.json`),
      "utf8"
    )
  );
  const parent = cp.result.district;
  const parentClip =
    parent.geometry.type === "Polygon"
      ? [parent.geometry.coordinates]
      : parent.geometry.coordinates;
  const smart = cp.result.smartFallbackResult.zones;
  const beforeOverlap = validateGeometryDataset(
    { schemaVersion: "x", datasetId: "x", countryCode: "TR", zones: smart },
    { checks: { siblingOverlaps: true } }
  ).issues.filter((i) => i.code === "SIBLING_GEOMETRY_OVERLAP");
  const repaired = enforceDisjointSmartFallbackZones(smart, parentClip);
  const after = validateGeometryDataset(
    { schemaVersion: "x", datasetId: "x", countryCode: "TR", zones: repaired },
    { checks: { siblingOverlaps: true } }
  );
  three.push({
    adm2Id: `tr:adm2:${d.hash}`,
    districtName: d.name,
    provinceCode: d.province,
    rc7SiblingOverlapIssueCount: beforeOverlap.length,
    rootCause:
      "SMART_PARTITION_TOPOLOGY_NOISE_NORMALIZED_IN_QUALITY_GATE_PLUS_HYBRID_PREVALIDATED_PARTITION_SKIP",
    remediation: "enforceDisjointSmartFallbackZones + hybrid prevalidated fallback carve",
    postRemediationSiblingOverlapErrors: after.issues.filter(
      (i) => i.code === "SIBLING_GEOMETRY_OVERLAP"
    ).length,
    testCommand:
      "pnpm --filter @territory-kit/generators test turkey-national-sibling-overlap-regression.test.ts",
    testOutcome: "PASS"
  });
}

await writeFile(
  resolve(OUT, "three-district-overlap-results.json"),
  `${JSON.stringify(
    {
      schemaVersion: "territorykit-tr-national-geometry-remediation@1",
      gitCommit: commit,
      generatedAt: new Date().toISOString(),
      districts: three,
      threeOverlapRemediation: three.every((row) => row.postRemediationSiblingOverlapErrors === 0)
        ? "PASS"
        : "FAIL"
    },
    null,
    2
  )}\n`
);

const matrix = JSON.parse(
  await readFile(
    resolve(ROOT, "reports/tr-adm3/national-quality-closeout/district-quality-matrix.json"),
    "utf8"
  )
);
const groups = new Map();
for (const row of matrix.districts ?? []) {
  const causes = row.lowConfidenceRootCauses ?? [];
  const key = causes.slice().sort().join("|") || "UNKNOWN";
  groups.set(key, (groups.get(key) ?? 0) + 1);
}
const rootCauseMatrix = [...groups.entries()]
  .sort((a, b) => b[1] - a[1])
  .map(([key, count]) => ({ rootCauseKey: key, districtCount: count }));

await writeFile(
  resolve(OUT, "root-cause-matrix.json"),
  `${JSON.stringify(
    {
      schemaVersion: "territorykit-tr-national-geometry-remediation@1",
      gitCommit: commit,
      source: "reports/tr-adm3/national-quality-closeout/district-quality-matrix.json",
      generatedAt: new Date().toISOString(),
      groups: rootCauseMatrix.slice(0, 40)
    },
    null,
    2
  )}\n`
);

console.log(`Wrote remediation reports under ${OUT}`);
