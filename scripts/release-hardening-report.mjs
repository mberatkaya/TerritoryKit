#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative } from "node:path";
import { format as formatPrettier, resolveConfig } from "prettier";
import YAML from "yaml";
import {
  evaluateAuditExceptions,
  inspectDocsDevServerExposure
} from "./security-audit-exceptions.mjs";

const root = process.cwd();
const outputDir = join(root, "docs", "release-artifacts");
const requireFromRoot = createRequire(join(root, "package.json"));
const publicPackages = readPublicPackages();

mkdirSync(outputDir, { recursive: true });

const audit = runJson("pnpm", ["audit", "--prod", "--json"], { allowFailure: true });
const fullAudit = runJson("pnpm", ["audit", "--json"], { allowFailure: true });
const exceptionPolicy = readJson("reports/baselines/sprint-7-security-exceptions.json");
const docsDevServerExposure = inspectDocsDevServerExposure(root);
const auditExceptionDecision = evaluateAuditExceptions({
  productionAudit: audit,
  fullAudit,
  policy: exceptionPolicy,
  exposure: docsDevServerExposure,
  today: new Date().toISOString().slice(0, 10)
});
const prodLicenseInventory = runJson("pnpm", ["licenses", "list", "--prod", "--json"]);
const packageDryRun = runJson("node", ["scripts/package-dry-run.mjs"]);
const changesetStatus = runText("pnpm", ["changeset", "status", "--verbose"], {
  allowFailure: true
});
const changesetStatusOk = isChangesetStatusOk(changesetStatus);

const benchmarkPath = join(outputDir, "turkey-adm2-benchmark.json");
runText("node", [
  "scripts/benchmark-run.mjs",
  "--mode",
  "local-real",
  "--dataset",
  "datasets/generated/countries/TR/levels/ADM2/dataset.json",
  "--scenario",
  "turkey-adm2-production",
  "--iterations",
  "5000",
  "--output",
  relative(root, benchmarkPath)
]);
const benchmarkComparison = runJson("node", [
  "scripts/benchmark-compare.mjs",
  "--baseline",
  "benchmarks/baselines/turkey-adm2-production.json",
  "--current",
  relative(root, benchmarkPath)
]);

const exports = await validateExports();
const packageMetadata = validatePackageMetadata(publicPackages);
const importBoundaries = inspectImportBoundaries();
const workflowSecurity = inspectWorkflowSecurity();
const turkey = collectTurkeyEvidence();
const turkeyV2 = collectTurkeyV2StableEvidence();
const coverage = existsSync(join(root, "coverage", "coverage-summary.json"))
  ? readJson("coverage/coverage-summary.json").total
  : undefined;
const licenseSummary = summarizeLicenses(prodLicenseInventory);
const releaseDecisionInputs = {
  auditExceptionPolicyOk: auditExceptionDecision.ok,
  publicPackageMetadataOk: packageMetadata.ok,
  packageDryRunOk: packageDryRun.ok,
  exportsOk: exports.ok,
  importBoundariesOk: importBoundaries.ok,
  turkeyAdm0Adm2ChecksumOk: turkey.adm0Adm2.checksums.ok,
  turkeyAdm3ChecksumOk: turkey.adm3.checksums.ok,
  turkeyV2StableNationalOk: turkeyV2.ok,
  turkeyBenchmarkOk: benchmarkComparison.ok,
  changesetStatusOk,
  workflowSecurityOk: workflowSecurity.ok
};
const releaseGateOk = Object.values(releaseDecisionInputs).every((value) => value === true);

const reportPath = join(outputDir, "production-hardening-report.json");
const licenseInventoryPath = join(outputDir, "license-inventory.prod.json");

await writeJson(licenseInventoryPath, {
  schemaVersion: "territorykit-license-inventory@1",
  generatedAt: new Date().toISOString(),
  scope: "pnpm licenses list --prod --json",
  summary: licenseSummary,
  inventory: prodLicenseInventory
});

await writeJson(reportPath, {
  schemaVersion: "territorykit-production-hardening-report@1",
  ok: releaseGateOk,
  generatedAt: new Date().toISOString(),
  git: {
    branch: runText("git", ["branch", "--show-current"]).stdout.trim(),
    auditedCodeHead: runText("git", ["rev-parse", "HEAD"]).stdout.trim(),
    auditedTreeHash: runText("git", ["rev-parse", "HEAD^{tree}"]).stdout.trim()
  },
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    packageManager: readJson("package.json").packageManager,
    pnpmVersion: runText("pnpm", ["--version"]).stdout.trim(),
    lockfileSha256: createHash("sha256")
      .update(readFileSync(join(root, "pnpm-lock.yaml")))
      .digest("hex")
  },
  releaseDecisionInputs,
  security: {
    audit,
    fullAudit,
    rawAudit: auditExceptionDecision.rawAudit,
    approvedExceptions: auditExceptionDecision.approvedExceptions,
    effectiveBlockingFindings: auditExceptionDecision.effectiveBlockingFindings,
    docsDevServerExposure,
    workflowSecurity
  },
  licenses: licenseSummary,
  packageMetadata,
  packageDryRun,
  exports,
  importBoundaries,
  coverage,
  turkey,
  turkeyV2,
  benchmarkComparison,
  changesetStatus: {
    ok: changesetStatusOk,
    output: [changesetStatus.stdout, changesetStatus.stderr].join("\n").trim()
  }
});

await writeJson(join(outputDir, "checksums.json"), {
  schemaVersion: "territorykit-release-artifact-checksums@1",
  generatedAt: new Date().toISOString(),
  files: Object.fromEntries(
    [
      "production-hardening-report.json",
      "license-inventory.prod.json",
      "turkey-adm2-benchmark.json"
    ].map((file) => [
      file,
      createHash("sha256")
        .update(readFileSync(join(outputDir, file)))
        .digest("hex")
    ])
  )
});

console.log(
  JSON.stringify(
    {
      ok: releaseGateOk,
      outputs: [
        "docs/release-artifacts/production-hardening-report.json",
        "docs/release-artifacts/license-inventory.prod.json",
        "docs/release-artifacts/turkey-adm2-benchmark.json",
        "docs/release-artifacts/checksums.json"
      ]
    },
    null,
    2
  )
);

process.exitCode = releaseGateOk ? 0 : 1;

function readPublicPackages() {
  return readdirSync(join(root, "packages"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const packageDir = join(root, "packages", entry.name);
      const manifestPath = join(packageDir, "package.json");
      if (!existsSync(manifestPath)) {
        return undefined;
      }
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      return manifest.private
        ? undefined
        : {
            dir: packageDir,
            relativeDir: relative(root, packageDir),
            manifest
          };
    })
    .filter(Boolean)
    .sort((left, right) => left.manifest.name.localeCompare(right.manifest.name));
}

function validatePackageMetadata(packages) {
  const issues = [];
  const packagesOut = packages.map(({ relativeDir, manifest }) => {
    if (!manifest.license) {
      issues.push(`${manifest.name} is missing license metadata.`);
    }

    if (!manifest.repository?.url) {
      issues.push(`${manifest.name} is missing repository metadata.`);
    }

    if (!manifest.publishConfig?.access || !manifest.publishConfig?.registry) {
      issues.push(`${manifest.name} is missing publishConfig access/registry metadata.`);
    }

    if (manifest.name !== "@territory-kit/cli" && manifest.sideEffects !== false) {
      issues.push(`${manifest.name} should declare sideEffects:false for tree-shaking.`);
    }

    for (const expected of [
      "dist/**/*.cjs",
      "dist/**/*.d.cts",
      "dist/**/*.d.mts",
      "dist/**/*.mjs",
      "README.md"
    ]) {
      if (!manifest.files?.includes(expected)) {
        issues.push(`${manifest.name} files allowlist is missing ${expected}.`);
      }
    }

    return {
      name: manifest.name,
      version: manifest.version,
      directory: relativeDir,
      license: manifest.license,
      sideEffects: manifest.sideEffects,
      files: manifest.files,
      publishConfig: manifest.publishConfig,
      peerDependencies: manifest.peerDependencies ?? {},
      dependencies: manifest.dependencies ?? {}
    };
  });

  return {
    ok: issues.length === 0,
    issues,
    packages: packagesOut
  };
}

async function validateExports() {
  const results = [];
  const issues = [];

  for (const { dir, manifest } of publicPackages) {
    for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
      const files = {
        import: join(dir, target.import),
        require: join(dir, target.require),
        types: join(dir, target.types)
      };

      for (const [kind, file] of Object.entries(files)) {
        if (!existsSync(file)) {
          issues.push(
            `${manifest.name}${subpath} ${kind} target is missing: ${relative(root, file)}.`
          );
        }
      }

      if (Object.values(files).every((file) => existsSync(file))) {
        try {
          await import(`file://${files.import}`);
          requireFromRoot(files.require);
        } catch (error) {
          issues.push(
            `${manifest.name}${subpath} failed ESM/CJS import smoke: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }

      results.push({
        package: manifest.name,
        subpath,
        import: relative(root, files.import),
        require: relative(root, files.require),
        types: relative(root, files.types)
      });
    }
  }

  return {
    ok: issues.length === 0,
    checkedExports: results.length,
    issues,
    results
  };
}

function inspectImportBoundaries() {
  const browserSafePackages = new Set([
    "packages/adapter-core",
    "packages/core",
    "packages/dataset",
    "packages/game",
    "packages/leaflet",
    "packages/maplibre",
    "packages/openlayers",
    "packages/react-native",
    "packages/runtime"
  ]);
  const issues = [];
  const scannedFiles = [];

  for (const packageDir of browserSafePackages) {
    const sourceDir = join(root, packageDir, "src");
    if (!existsSync(sourceDir)) {
      continue;
    }

    for (const file of listFiles(sourceDir).filter(
      (path) => path.endsWith(".ts") || path.endsWith(".tsx")
    )) {
      scannedFiles.push(relative(root, file));
      const source = readFileSync(file, "utf8");
      const nodeImports = [...source.matchAll(/(?:from\s+|import\s*\(\s*)["'](node:[^"']+)["']/g)];
      const nodeEntrypointImports = [
        ...source.matchAll(/(?:from\s+|import\s*\(\s*)["'](@territory-kit\/registry\/node)["']/g)
      ];

      for (const match of [...nodeImports, ...nodeEntrypointImports]) {
        issues.push(`${relative(root, file)} imports ${match[1]}.`);
      }
    }
  }

  return {
    ok: issues.length === 0,
    scannedFiles: scannedFiles.length,
    issues
  };
}

function inspectWorkflowSecurity() {
  const workflowDir = join(root, ".github", "workflows");
  const workflows = readdirSync(workflowDir)
    .filter((entry) => entry.endsWith(".yml") || entry.endsWith(".yaml"))
    .sort()
    .map((entry) => {
      const content = readFileSync(join(workflowDir, entry), "utf8");
      const document = YAML.parseDocument(content, { uniqueKeys: true });
      const workflow = document.toJS();
      const jobs = Object.entries(workflow.jobs ?? {}).map(([name, job]) => {
        const steps = job.steps ?? [];
        const uses = steps.filter((step) => typeof step.uses === "string").map((step) => step.uses);
        const runBlocks = steps
          .filter((step) => typeof step.run === "string")
          .map((step) => step.run);
        return {
          name,
          permissions: job.permissions ?? workflow.permissions ?? {},
          environment: job.environment ?? null,
          condition: job.if ?? null,
          unpinnedActions: uses.filter((value) => !/@[a-f0-9]{40}$/.test(value)),
          dispatchInterpolationInRun: runBlocks.some((value) => /\$\{\{\s*inputs\./.test(value)),
          installWithoutIgnoreScripts: runBlocks.some(
            (value) => /pnpm install/.test(value) && !/--ignore-scripts/.test(value)
          ),
          commandConstructionRisk: runBlocks.some((value) =>
            /(?:eval\s|bash\s+-c|sh\s+-c)/.test(value)
          ),
          secretBearing: steps.some((step) => /secrets\./.test(JSON.stringify(step.env ?? {}))),
          publishesNpm: runBlocks.some((value) => /pnpm release|npm publish/.test(value))
        };
      });
      return {
        file: `.github/workflows/${entry}`,
        parseErrors: document.errors.map((error) => error.message),
        dispatchInputs: Object.keys(workflow.on?.workflow_dispatch?.inputs ?? {}),
        pullRequestTarget: Boolean(workflow.on?.pull_request_target),
        jobs
      };
    });
  return {
    workflows,
    ok: workflows.every(
      (workflow) =>
        workflow.parseErrors.length === 0 &&
        !workflow.pullRequestTarget &&
        workflow.jobs.every(
          (job) =>
            job.unpinnedActions.length === 0 &&
            !job.dispatchInterpolationInRun &&
            !job.installWithoutIgnoreScripts &&
            !job.commandConstructionRisk
        )
    ),
    secretPolicy: {
      npmPublish:
        "Explicit dispatch and npm-production environment are required; only publish job has OIDC.",
      registryPublish:
        "TERRITORY_REGISTRY_PUBLISH_ENABLED=true is required for non-dry-run activation."
    }
  };
}

function collectTurkeyEvidence() {
  const admRoot = "datasets/generated/countries/TR";
  const adm3Root = `${admRoot}/levels/ADM3`;
  const manifest = readJson(`${admRoot}/manifest.json`);
  const adm3Coverage = readJson(`${adm3Root}/coverage.json`);
  const adm3Source = readJson(`${adm3Root}/source-metadata.json`);
  const adm3ArtifactPolicy = readJson(`${adm3Root}/artifact-size-report.json`);
  const adm3Quality = readJson(`${adm3Root}/production-quality-report.json`);
  const levelCounts = Object.fromEntries(
    ["ADM0", "ADM1", "ADM2"].map((level) => [
      level,
      readJson(`${admRoot}/levels/${level}/dataset.json`).zones.length
    ])
  );
  const adm3Dataset = readJson(`${adm3Root}/dataset.json`);
  const adm3ActualCount = adm3Dataset.zones.filter((zone) => zone.level === 3).length;

  return {
    adm0Adm2: {
      sourceLockHash: manifest.sourceLockHash,
      sourceProvider: manifest.sourceProvider,
      schemaVersion: manifest.schemaVersion,
      datasetVersion: manifest.datasetVersion,
      publishReady: manifest.publishReady,
      publishReadyFailures: manifest.publishReadyFailures,
      featureCountByLevel: levelCounts,
      geometryQualitySummary: manifest.geometryQualitySummary,
      geometryRepairSummary: manifest.geometryRepairSummary,
      hierarchySummary: manifest.hierarchySummary,
      adjacency: {
        ADM1: readJson(`${admRoot}/adjacency/ADM1/build-report.json`).statistics,
        ADM2: readJson(`${admRoot}/adjacency/ADM2/build-report.json`).statistics
      },
      checksums: verifyChecksums(admRoot)
    },
    adm3: {
      schemaVersion: adm3Coverage.schemaVersion,
      status: adm3Coverage.status,
      scopeType: adm3Coverage.scopeType,
      coveredProvince: adm3Coverage.coveredProvince,
      coveredParentCount: adm3Coverage.coveredParents.length,
      actualAdm3FeatureCount: adm3ActualCount,
      coverageFeatureCount: adm3Coverage.featureCount,
      sourceProvider: adm3Source.publisher,
      sourceVersion: adm3Source.sourceVersion,
      sourceSha256: adm3Source.expectedSha256,
      artifactPolicy: adm3ArtifactPolicy.summary,
      artifactPolicyOk: adm3ArtifactPolicy.ok,
      qualityCheckStatuses: adm3Quality.checkStatuses,
      checksums: verifyChecksums(adm3Root)
    }
  };
}

function collectTurkeyV2StableEvidence() {
  const reportRoot = "reports/tr-v2-national";
  const quality = readJson(`${reportRoot}/quality-report.json`);
  const coverage = readJson(`${reportRoot}/coverage.json`);
  const registry = readJson(`${reportRoot}/registry-entry.json`);
  const sourceLock = readJson(`${reportRoot}/source-lock.json`);
  const hierarchy = readJson(`${reportRoot}/hierarchy-report.json`);
  const buildSummary = readJson(`${reportRoot}/build-summary.json`);
  const dataset = Array.isArray(registry.datasets) ? registry.datasets[0] : undefined;
  const summary = quality.summary ?? {};
  const gates = {
    datasetVersion: coverage.datasetVersion === "2.0.0",
    sourceLockDatasetVersion: sourceLock.datasetVersion === "2.0.0",
    registryDatasetVersion: dataset?.version === "2.0.0",
    registryPrerelease: dataset?.prerelease === false,
    qualityOk: quality.ok === true,
    qualityPublishReady: quality.publishReady === true,
    buildMode: quality.buildMode === "publish-ready" && buildSummary.buildMode === "publish-ready",
    hardGateFailures:
      Array.isArray(quality.hardGateFailures) && quality.hardGateFailures.length === 0,
    publishReadyGateFailures:
      Array.isArray(quality.publishReadyGateFailures) &&
      quality.publishReadyGateFailures.length === 0,
    adm0Count: coverage.adm0Count === 1 && summary.adm0Count === 1,
    adm1Count: coverage.provinceCount === 81 && summary.adm1Count === 81,
    adm2Count: coverage.districtCount === 973 && summary.adm2Count === 973,
    successfulDistricts: coverage.successfulDistrictCount === 973,
    failedDistricts: coverage.failedDistrictCount === 0 && summary.failedDistrictCount === 0,
    everyDistrictHasAdm3:
      Array.isArray(coverage.districts) &&
      coverage.districts.length === 973 &&
      coverage.districts.every((district) => district.zoneCount > 0),
    districtsBelow9999:
      Array.isArray(coverage.districtsBelow9999) &&
      coverage.districtsBelow9999.length === 0 &&
      summary.districtsBelow9999 === 0,
    everyDistrictCoverage:
      Array.isArray(coverage.districts) &&
      coverage.districts.every((district) => district.finalCoveragePercent >= 99.99),
    nationalCoverage: coverage.finalCoveragePercent >= 99.99,
    invalidGeometry:
      quality.geometryValidation?.ok === true &&
      quality.geometryValidation?.errorCount === 0 &&
      summary.invalidFinalGeometryCount === 0,
    emptyGeometry: summary.emptyFinalGeometryCount === 0,
    orphanCount: summary.orphanCount === 0 && hierarchy.orphanCount === 0,
    hierarchyCycles: summary.hierarchyCycleCount === 0 && hierarchy.cycleCount === 0,
    duplicateStableIds: summary.duplicateStableIdCount === 0 && hierarchy.duplicateIdCount === 0,
    parentContainment: summary.parentContainmentErrorCount === 0,
    effectiveSiblingOverlap: summary.effectiveSiblingOverlapCount === 0,
    realGeneratedOverlap: summary.realGeneratedOverlapCount === 0,
    missingProvenance: summary.missingProvenanceCount === 0,
    missingAttributionLicense: summary.missingAttributionLicenseCount === 0,
    generatedMetadata: summary.generatedMetadataErrorCount === 0,
    strictTrV2Validation:
      quality.strictValidation?.ok === true && summary.strictTrV2ValidationErrorCount === 0,
    adjacencyIntegrity: summary.adjacencyIntegrityErrorCount === 0,
    registryChecksumIntegrity:
      quality.artifactIntegrity?.ok === true &&
      quality.artifactIntegrity?.errorCount === 0 &&
      summary.registryArtifactChecksumErrors === 0,
    registryArtifacts:
      dataset !== undefined &&
      Array.isArray(dataset.artifacts) &&
      dataset.artifacts.length > 0 &&
      dataset.artifacts.every(
        (artifact) =>
          /^[a-f0-9]{64}$/.test(artifact.sha256) &&
          artifact.sizeBytes > 0 &&
          !artifact.path.startsWith("/") &&
          !artifact.path.includes("..")
      ),
    generatedZonesNonOfficial:
      coverage.generatedZoneCount > 0 &&
      summary.generatedMetadataErrorCount === 0 &&
      quality.strictValidation?.ok === true,
    externalNationalGeometry:
      sourceLock.distribution?.largeGeometryInNpmPackage === false &&
      sourceLock.distribution?.registryCdnOfflineModel === true
  };

  return {
    ok: Object.values(gates).every((value) => value === true),
    reportRoot,
    gates,
    dataset: {
      id: coverage.datasetId,
      version: coverage.datasetVersion,
      registryVersion: dataset?.version,
      registryPrerelease: dataset?.prerelease,
      buildDate: coverage.buildDate,
      buildMode: quality.buildMode,
      publishReady: quality.publishReady
    },
    counts: {
      ADM0: coverage.adm0Count,
      ADM1: coverage.provinceCount,
      ADM2: coverage.districtCount,
      ADM3: coverage.adm3FinalZoneCount,
      successfulDistricts: coverage.successfulDistrictCount,
      failedDistricts: coverage.failedDistrictCount,
      districtsBelow9999: coverage.districtsBelow9999?.length ?? null,
      officialADM3: coverage.officialZoneCount,
      osmADM3: coverage.osmZoneCount,
      generatedADM3: coverage.generatedZoneCount
    },
    coverage: {
      realCoveragePercent: coverage.realCoveragePercent,
      generatedCoveragePercent: coverage.generatedCoveragePercent,
      finalCoveragePercent: coverage.finalCoveragePercent
    },
    quality: {
      ok: quality.ok,
      publishReady: quality.publishReady,
      hardGateFailures: quality.hardGateFailures,
      publishReadyGateFailures: quality.publishReadyGateFailures,
      summary,
      geometryValidation: quality.geometryValidation,
      artifactIntegrity: quality.artifactIntegrity
    },
    hashes: {
      sourceLockHash: sourceLock.contentHash,
      deterministicHash: coverage.deterministicHash
    }
  };
}

function verifyChecksums(relativeRoot) {
  const checksumPath = join(root, relativeRoot, "checksums.json");
  const checksums = JSON.parse(readFileSync(checksumPath, "utf8"));
  const files = checksums.files ?? checksums;
  const mismatches = [];
  let checked = 0;

  for (const [relativeFile, expected] of Object.entries(files)) {
    const file = join(root, relativeRoot, relativeFile);
    if (!existsSync(file)) {
      mismatches.push(`${relativeRoot}/${relativeFile} is missing.`);
      continue;
    }
    checked += 1;
    const actual = createHash("sha256").update(readFileSync(file)).digest("hex");
    if (actual !== expected) {
      mismatches.push(`${relativeRoot}/${relativeFile} expected ${expected}, got ${actual}.`);
    }
  }

  return {
    ok: mismatches.length === 0,
    checkedFiles: checked,
    mismatches
  };
}

function summarizeLicenses(inventory) {
  const licenses = Object.entries(inventory)
    .map(([license, entries]) => ({
      license,
      packageCount: entries.length,
      packages: entries.map((entry) => ({
        name: entry.name,
        versions: entry.versions,
        license: entry.license,
        homepage: entry.homepage
      }))
    }))
    .sort((left, right) => left.license.localeCompare(right.license));

  return {
    licenseCount: licenses.length,
    packageCount: licenses.reduce((sum, entry) => sum + entry.packageCount, 0),
    unknown: licenses.find((entry) => entry.license.toLowerCase() === "unknown")?.packages ?? [],
    licenses
  };
}

function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(join(root, relativePath), "utf8"));
}

function isChangesetStatusOk(status) {
  if (status.status === 0) {
    return true;
  }

  const output = `${status.stdout}\n${status.stderr}`;
  const pendingChangesets = readdirSync(join(root, ".changeset")).filter((entry) =>
    entry.endsWith(".md")
  );

  return pendingChangesets.length === 0 && output.includes("no changesets were found");
}

async function writeJson(path, payload) {
  const config = (await resolveConfig(path)) ?? {};
  const formatted = await formatPrettier(JSON.stringify(payload), { ...config, parser: "json" });
  writeFileSync(path, formatted, "utf8");
}

function runJson(command, args, options = {}) {
  const result = runText(command, args, options);
  const text = result.stdout.trim();

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Could not parse JSON from ${command} ${args.join(" ")}: ${text}`);
  }
}

function runText(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32"
  });

  if (result.status !== 0 && !options.allowFailure) {
    const error = new Error(
      `${command} ${args.join(" ")} failed with ${result.status}\n${result.stdout}\n${result.stderr}`
    );
    error.status = result.status;
    throw error;
  }

  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr
  };
}
