import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import type { TerritoryAdminLevel } from "@territory-kit/dataset";
import { pathExists, serializeJsonStable } from "../sources/utils.js";
import {
  buildTerritoryCountryDatasetPath,
  validateTerritoryCountryDatasetPath
} from "./builder.js";
import { createTerritoryCountrySourceLock } from "./source-lock.js";
import { getTerritoryCountryConfig, listTerritoryCountryConfigs } from "./registry.js";
import type {
  TerritoryArtifactStatus,
  TerritoryCountryBuildAllCountryResult,
  TerritoryCountryBuildAllOptions,
  TerritoryCountryBuildAllOutcome,
  TerritoryCountryBuildAllReport,
  TerritoryCountryBuildIssue,
  TerritoryCountryBuildReport
} from "./types.js";

export async function buildAllTerritoryCountryDatasets(
  options: TerritoryCountryBuildAllOptions
): Promise<TerritoryCountryBuildAllReport> {
  const cwd = options.cwd ?? process.cwd();
  const generatedAt = resolveBuildTimestamp(options.buildDate);
  const outputRoot = resolve(cwd, options.outputRoot);
  const countries = resolveCountryList(options.countries);
  const previousReport =
    options.resume || options.retryFailed
      ? await readPreviousReport(options.reportPath, cwd)
      : undefined;
  const previousByCountry = new Map(
    previousReport?.results.map((result) => [result.country, result]) ?? []
  );
  const queue = countries.filter((country) => {
    const previous = previousByCountry.get(country.countryCodeAlpha2);

    if (!previous || options.retryFailed) {
      return true;
    }

    return previous.outcome !== "built";
  });
  const reusedResults = countries.flatMap((country) => {
    const previous = previousByCountry.get(country.countryCodeAlpha2);
    return previous && options.resume && previous.outcome === "built" ? [previous] : [];
  });
  const results: TerritoryCountryBuildAllCountryResult[] = [...reusedResults];
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 2, 8));
  let cursor = 0;
  let writeReport = Promise.resolve();

  await mkdir(outputRoot, { recursive: true });

  async function worker(): Promise<void> {
    while (cursor < queue.length) {
      const index = cursor;
      cursor += 1;
      const config = queue[index];

      if (!config) {
        continue;
      }

      const result = await buildOneCountry({
        country: config.countryCodeAlpha2,
        levels: options.levels,
        outputRoot,
        generatedAt,
        ...(options.releaseType ? { releaseType: options.releaseType } : {}),
        ...(options.provider ? { provider: options.provider } : {}),
        ...(options.offline ? { offline: true } : {}),
        ...(options.cacheDir ? { cacheDir: resolve(cwd, options.cacheDir) } : {}),
        ...(options.force ? { force: true } : {}),
        cwd
      });
      results.push(result);

      if (options.reportPath) {
        const snapshot = createBuildAllReport({
          generatedAt,
          levels: [...options.levels],
          results: [...results].sort((left, right) => left.country.localeCompare(right.country))
        });
        writeReport = writeReport.then(() =>
          writeReportFile(resolve(cwd, options.reportPath!), snapshot)
        );
        await writeReport;
      }

      if (!options.continueOnError && result.outcome !== "built") {
        cursor = queue.length;
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  const sortedResults = results.sort((left, right) => left.country.localeCompare(right.country));
  const report = createBuildAllReport({
    generatedAt,
    levels: [...options.levels],
    results: sortedResults
  });

  if (options.reportPath) {
    await writeReportFile(resolve(cwd, options.reportPath), report);
  }

  return report;
}

async function writeReportFile(
  reportPath: string,
  report: TerritoryCountryBuildAllReport
): Promise<void> {
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, serializeJsonStable(report), "utf8");
}

async function buildOneCountry(input: {
  country: string;
  levels: readonly TerritoryAdminLevel[];
  outputRoot: string;
  generatedAt: string;
  releaseType?: string;
  provider?: string;
  offline?: boolean;
  cacheDir?: string;
  force?: boolean;
  cwd: string;
}): Promise<TerritoryCountryBuildAllCountryResult> {
  const config = getTerritoryCountryConfig(input.country);
  const countryRoot = join(input.outputRoot, config.countryCodeAlpha2);
  const sourceLockPath = join(countryRoot, "sources.lock.json");
  const reportCountryRoot = toPortableReportPath(countryRoot, input.cwd);
  const reportSourceLockPath = toPortableReportPath(sourceLockPath, input.cwd);
  const buildLevels = withRequiredAncestorLevels(input.levels);
  const issues: TerritoryCountryBuildIssue[] = [];
  const startedAt = input.generatedAt;

  if (input.provider && input.provider !== config.sourceProvider) {
    const issue = {
      code: "PROVIDER_OVERRIDE_UNSUPPORTED",
      severity: "error" as const,
      message: `Provider override '${input.provider}' is not configured for ${config.countryCodeAlpha2}.`
    };
    return createCountryResult({
      config,
      countryRoot: reportCountryRoot,
      sourceLockPath: reportSourceLockPath,
      levels: input.levels,
      outcome: "provider-error",
      status: "source-unavailable",
      issues: [issue],
      startedAt,
      finishedAt: input.generatedAt
    });
  }

  try {
    await mkdir(countryRoot, { recursive: true });

    if (!input.offline) {
      const lock = await createTerritoryCountrySourceLock({
        country: config.countryCodeAlpha2,
        levels: buildLevels,
        outputPath: sourceLockPath,
        ...(input.releaseType ? { releaseType: input.releaseType } : {}),
        ...(input.cacheDir ? { cacheDir: input.cacheDir } : {}),
        buildDate: input.generatedAt,
        force: true,
        cwd: input.cwd
      });
      issues.push(...lock.issues);
    } else if (!(await pathExists(sourceLockPath))) {
      return createCountryResult({
        config,
        countryRoot: reportCountryRoot,
        sourceLockPath: reportSourceLockPath,
        levels: input.levels,
        outcome: "source-unavailable",
        status: "source-unavailable",
        issues: [
          {
            code: "OFFLINE_SOURCE_LOCK_MISSING",
            severity: "error",
            message: `Offline build requires ${reportSourceLockPath}.`
          }
        ],
        startedAt,
        finishedAt: input.generatedAt
      });
    }

    const sourceLock = JSON.parse(await readFile(sourceLockPath, "utf8")) as {
      levels: Partial<Record<TerritoryAdminLevel, { status: string; license?: string }>>;
    };
    const availableLevels = input.levels.filter(
      (level) => sourceLock.levels[level]?.status === "available"
    );

    if (availableLevels.length === 0) {
      return createCountryResult({
        config,
        countryRoot: reportCountryRoot,
        sourceLockPath: reportSourceLockPath,
        levels: input.levels,
        outcome: "source-unavailable",
        status: "source-unavailable",
        issues,
        startedAt,
        finishedAt: input.generatedAt
      });
    }

    const restrictedLevel = availableLevels.find((level) => {
      const license = sourceLock.levels[level]?.license?.toLowerCase() ?? "";
      return config.licensePolicy.rejectUnknownLicense && (!license || license === "unknown");
    });

    if (restrictedLevel) {
      issues.push({
        code: "SOURCE_LICENSE_RESTRICTED",
        severity: "error",
        message: `${restrictedLevel} does not include an acceptable license.`,
        level: restrictedLevel
      });
      return createCountryResult({
        config,
        countryRoot: reportCountryRoot,
        sourceLockPath: reportSourceLockPath,
        levels: input.levels,
        outcome: "licence-restricted",
        status: "license-restricted",
        issues,
        startedAt,
        finishedAt: input.generatedAt
      });
    }

    const build = await buildTerritoryCountryDatasetPath({
      country: config.countryCodeAlpha2,
      sourceLockPath,
      outputPath: countryRoot,
      levels: buildLevels,
      buildAdjacency: true,
      allowNonPublishReady: true,
      buildDate: input.generatedAt,
      force: true,
      cwd: input.cwd
    });
    issues.push(...build.issues);
    const validation = await validateTerritoryCountryDatasetPath(countryRoot, { strict: false });
    issues.push(...validation.issues);
    const hasError = issues.some((issue) => issue.severity === "error");

    return createCountryResult({
      config,
      countryRoot: reportCountryRoot,
      sourceLockPath: reportSourceLockPath,
      levels: input.levels,
      outcome: hasError ? "validation-failed" : "built",
      status: hasError ? "validation-failed" : "built",
      issues,
      buildReport: build.buildReport,
      startedAt,
      finishedAt: input.generatedAt
    });
  } catch (error) {
    return createCountryResult({
      config,
      countryRoot: reportCountryRoot,
      sourceLockPath: reportSourceLockPath,
      levels: input.levels,
      outcome: "provider-error",
      status: "source-unavailable",
      issues: [
        ...issues,
        {
          code: "COUNTRY_BUILD_FAILED",
          severity: "error",
          message: error instanceof Error ? error.message : String(error)
        }
      ],
      startedAt,
      finishedAt: input.generatedAt
    });
  }
}

function createCountryResult(input: {
  config: ReturnType<typeof getTerritoryCountryConfig>;
  countryRoot: string;
  sourceLockPath: string;
  levels: readonly TerritoryAdminLevel[];
  outcome: TerritoryCountryBuildAllOutcome;
  status: TerritoryArtifactStatus;
  issues: TerritoryCountryBuildIssue[];
  buildReport?: TerritoryCountryBuildReport;
  startedAt: string;
  finishedAt: string;
}): TerritoryCountryBuildAllCountryResult {
  return {
    country: input.config.countryCodeAlpha2,
    alpha3: input.config.countryCodeAlpha3,
    provider: input.config.sourceProvider,
    outputPath: input.countryRoot,
    sourceLockPath: input.sourceLockPath,
    levels: input.levels.map((level) => ({
      level,
      status:
        input.status === "built" && input.buildReport?.statistics.builtLevels.includes(level)
          ? "built"
          : input.status,
      outcome: input.outcome,
      ...(input.buildReport?.statistics.featureCountByLevel[level] !== undefined
        ? { featureCount: input.buildReport.statistics.featureCountByLevel[level] }
        : {}),
      issueCodes: input.issues
        .filter((issue) => !issue.level || issue.level === level)
        .map((issue) => issue.code)
        .sort()
    })),
    outcome: input.outcome,
    issueCount: input.issues.length,
    issues: input.issues.sort(
      (left, right) =>
        (left.level ?? "").localeCompare(right.level ?? "") || left.code.localeCompare(right.code)
    ),
    startedAt: input.startedAt,
    finishedAt: input.finishedAt
  };
}

function withRequiredAncestorLevels(
  levels: readonly TerritoryAdminLevel[]
): readonly TerritoryAdminLevel[] {
  const requested = new Set(levels);
  const ordered: TerritoryAdminLevel[] = [];

  if (
    requested.has("ADM0") ||
    requested.has("ADM1") ||
    requested.has("ADM2") ||
    requested.has("ADM3") ||
    requested.has("ADM4")
  ) {
    ordered.push("ADM0");
  }

  for (const level of ["ADM1", "ADM2", "ADM3", "ADM4"] as const) {
    if (requested.has(level)) {
      ordered.push(level);
    }
  }

  return ordered;
}

function toPortableReportPath(path: string, cwd: string): string {
  const portable = relative(resolve(cwd), path);

  return portable && !portable.startsWith("..") ? portable : path;
}

function createBuildAllReport(input: {
  generatedAt: string;
  levels: TerritoryAdminLevel[];
  results: TerritoryCountryBuildAllCountryResult[];
}): TerritoryCountryBuildAllReport {
  const outcomes = {
    built: 0,
    "validation-failed": 0,
    "source-unavailable": 0,
    "licence-restricted": 0,
    "provider-error": 0,
    "mapping-review-required": 0
  } satisfies Record<TerritoryCountryBuildAllOutcome, number>;

  for (const result of input.results) {
    outcomes[result.outcome] += 1;
  }

  return {
    reportVersion: "1",
    generatedAt: input.generatedAt,
    levels: input.levels,
    countriesAttempted: input.results.length,
    countriesSucceeded: outcomes.built,
    countriesFailed: input.results.length - outcomes.built,
    outcomes,
    results: input.results
  };
}

function resolveCountryList(countries: readonly string[] | undefined) {
  if (!countries || countries.length === 0) {
    return listTerritoryCountryConfigs();
  }

  return countries.map((country) => getTerritoryCountryConfig(country));
}

async function readPreviousReport(
  reportPath: string | undefined,
  cwd: string
): Promise<TerritoryCountryBuildAllReport | undefined> {
  if (!reportPath) {
    return undefined;
  }

  const resolved = resolve(cwd, reportPath);

  if (!(await pathExists(resolved))) {
    return undefined;
  }

  return JSON.parse(await readFile(resolved, "utf8")) as TerritoryCountryBuildAllReport;
}

function resolveBuildTimestamp(buildDate: string | undefined): string {
  if (buildDate) {
    return new Date(buildDate).toISOString();
  }

  const sourceDateEpoch = process.env.SOURCE_DATE_EPOCH;

  if (sourceDateEpoch && /^\d+$/.test(sourceDateEpoch)) {
    return new Date(Number(sourceDateEpoch) * 1000).toISOString();
  }

  return new Date().toISOString();
}
