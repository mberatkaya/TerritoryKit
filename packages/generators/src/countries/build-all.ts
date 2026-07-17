import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import {
  TERRITORY_ADMIN_LEVELS,
  compareAdminLevels,
  getAdminLevelDepth
} from "@territory-kit/dataset";
import type { TerritoryAdminLevel } from "@territory-kit/dataset";
import { pathExists, serializeJsonStable } from "../sources/utils.js";
import {
  buildTerritoryCountryDatasetPath,
  validateTerritoryCountryDatasetPath
} from "./builder.js";
import { getTerritoryCountryConfig, listTerritoryCountryConfigs } from "./registry.js";
import { createTerritoryCountrySourceLock } from "./source-lock.js";
import type {
  TerritoryArtifactStatus,
  TerritoryCountryBuildAllCountryResult,
  TerritoryCountryBuildAllOptions,
  TerritoryCountryBuildAllOutcome,
  TerritoryCountryBuildAllReport,
  TerritoryCountryBuildIssue,
  TerritoryCountryBuildPhase,
  TerritoryCountryBuildPhaseEvent,
  TerritoryCountryBuildPhaseTiming,
  TerritoryCountryBuildReport,
  TerritoryCountryLevelLifecycle,
  TerritoryLifecycleStatus
} from "./types.js";

const NON_RETRYABLE_OUTCOMES = new Set<TerritoryCountryBuildAllOutcome>([
  "built",
  "built-with-warnings",
  "source-unavailable",
  "licence-restricted",
  "mapping-review-required",
  "not-applicable",
  "performance-deferred"
]);

const SOURCE_UNAVAILABLE_CODES = new Set([
  "COUNTRY_LEVEL_UNAVAILABLE",
  "OFFLINE_SOURCE_LOCK_MISSING",
  "SOURCE_ACQUIRE_FAILED",
  "SOURCE_METADATA_AMBIGUOUS",
  "SOURCE_METADATA_INVALID",
  "SOURCE_METADATA_NOT_FOUND",
  "SOURCE_PROTOCOL_UNSUPPORTED",
  "SOURCE_URL_INVALID",
  "SOURCE_URL_MISSING"
]);

export async function buildAllTerritoryCountryDatasets(
  options: TerritoryCountryBuildAllOptions
): Promise<TerritoryCountryBuildAllReport> {
  const cwd = options.cwd ?? process.cwd();
  const generatedAt = resolveBuildTimestamp(options.buildDate);
  const outputRoot = resolve(cwd, options.outputRoot);
  const countries = resolveCountryList(options.countries, options.excludeCountries);
  const previousReport =
    options.resume || options.retryFailed
      ? await readPreviousReport(options.reportPath, cwd)
      : undefined;
  const previousByCountry = new Map(
    previousReport?.results.map((result) => [result.country, result]) ?? []
  );
  const selectedCountryCodes = new Set(countries.map((country) => country.countryCodeAlpha2));
  const queue = countries.filter((country) => {
    const previous = previousByCountry.get(country.countryCodeAlpha2);

    if (!previous) {
      return true;
    }

    if (options.resume && NON_RETRYABLE_OUTCOMES.has(previous.outcome)) {
      return false;
    }

    if (options.retryFailed) {
      return !NON_RETRYABLE_OUTCOMES.has(previous.outcome);
    }

    return !NON_RETRYABLE_OUTCOMES.has(previous.outcome);
  });
  const reusedResults = countries.flatMap((country) => {
    const previous = previousByCountry.get(country.countryCodeAlpha2);
    return previous && options.resume && NON_RETRYABLE_OUTCOMES.has(previous.outcome)
      ? [previous]
      : [];
  });
  const previousUnselectedResults =
    previousReport?.results.filter((result) => !selectedCountryCodes.has(result.country)) ?? [];
  const results: TerritoryCountryBuildAllCountryResult[] = [
    ...previousUnselectedResults,
    ...reusedResults
  ];
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
        ...(options.maxSourceBytes ? { maxSourceBytes: options.maxSourceBytes } : {}),
        ...(options.countryTimeoutMs ? { countryTimeoutMs: options.countryTimeoutMs } : {}),
        ...(options.phaseTimeoutMs ? { phaseTimeoutMs: options.phaseTimeoutMs } : {}),
        buildAdjacency: options.buildAdjacency ?? true,
        ...(options.onPhase ? { onPhase: options.onPhase } : {}),
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

      if (!options.continueOnError && !isSuccessfulOutcome(result.outcome)) {
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
  maxSourceBytes?: number;
  countryTimeoutMs?: number;
  phaseTimeoutMs?: number;
  buildAdjacency: boolean;
  onPhase?: (event: TerritoryCountryBuildPhaseEvent) => void;
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
  const countryStartedAt = Date.now();
  const phaseTimings: TerritoryCountryBuildPhaseTiming[] = [];
  const onPhase = createPhaseRecorder({
    phaseTimings,
    ...(input.onPhase ? { onPhase: input.onPhase } : {})
  });
  const runPhase = createPhaseRunner({
    country: config.countryCodeAlpha2,
    ...(input.phaseTimeoutMs ? { timeoutMs: input.phaseTimeoutMs } : {}),
    onPhase
  });

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
      outcome: "provider-unsupported",
      status: "provider-unsupported",
      issues: [issue],
      phaseTimings,
      startedAt,
      finishedAt: input.generatedAt
    });
  }

  try {
    await runPhase("source-resolution", {}, async () => {
      await mkdir(countryRoot, { recursive: true });

      if (!input.offline) {
        assertCountryNotTimedOut(input.countryTimeoutMs, countryStartedAt);
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
      }
    });

    if (input.offline && !(await pathExists(sourceLockPath))) {
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
        phaseTimings,
        startedAt,
        finishedAt: input.generatedAt
      });
    }

    const sourceLock = JSON.parse(await readFile(sourceLockPath, "utf8")) as {
      levels: Partial<
        Record<TerritoryAdminLevel, { status: string; license?: string; sizeBytes?: number }>
      >;
    };
    const availableLevels = input.levels.filter(
      (level) => sourceLock.levels[level]?.status === "available"
    );
    const sourceUnavailableLevels = input.levels.filter(
      (level) => sourceLock.levels[level]?.status !== "available"
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
        sourceUnavailableLevels,
        phaseTimings,
        startedAt,
        finishedAt: input.generatedAt
      });
    }

    const availableInputBytes = availableLevels.reduce(
      (sum, level) => sum + (sourceLock.levels[level]?.sizeBytes ?? 0),
      0
    );
    await runPhase("download", { inputBytes: availableInputBytes }, async () => undefined);
    await runPhase("extraction", { inputBytes: availableInputBytes }, async () => undefined);

    const oversizedLevel = input.maxSourceBytes
      ? availableLevels.find(
          (level) => (sourceLock.levels[level]?.sizeBytes ?? 0) > input.maxSourceBytes!
        )
      : undefined;

    if (oversizedLevel) {
      const sizeBytes = sourceLock.levels[oversizedLevel]?.sizeBytes ?? 0;
      issues.push({
        code: "SOURCE_GEOMETRY_TOO_LARGE_FOR_INLINE_BUILD",
        severity: "warning",
        message: `${oversizedLevel} source is ${sizeBytes} bytes, above the configured ${input.maxSourceBytes} byte build guard.`,
        level: oversizedLevel,
        details: {
          sizeBytes,
          maxSourceBytes: input.maxSourceBytes,
          outcome: "performance-deferred",
          phase: "download"
        }
      });
      return createCountryResult({
        config,
        countryRoot: reportCountryRoot,
        sourceLockPath: reportSourceLockPath,
        levels: input.levels,
        outcome: "performance-deferred",
        status: "performance-deferred",
        issues,
        sourceUnavailableLevels,
        phaseTimings,
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
        status: "licence-restricted",
        issues,
        sourceUnavailableLevels,
        phaseTimings,
        startedAt,
        finishedAt: input.generatedAt
      });
    }

    for (const level of availableLevels) {
      if (config.levelMappings[level]?.reviewStatus === "mapping-review-required") {
        issues.push({
          code: "MAPPING_REVIEW_REQUIRED",
          severity: "warning",
          message: `${level} uses a generic ISO fallback mapping; semantic labels require review before publishing.`,
          level
        });
      }
    }

    assertCountryNotTimedOut(input.countryTimeoutMs, countryStartedAt);
    const build = await buildTerritoryCountryDatasetPath({
      country: config.countryCodeAlpha2,
      sourceLockPath,
      outputPath: countryRoot,
      levels: buildLevels,
      buildAdjacency: input.buildAdjacency,
      allowNonPublishReady: true,
      buildDate: input.generatedAt,
      onPhase,
      force: true,
      cwd: input.cwd,
      ...(input.cacheDir ? { cacheDir: input.cacheDir } : {}),
      ...(input.phaseTimeoutMs ? { phaseTimeoutMs: input.phaseTimeoutMs } : {})
    });
    issues.push(...build.issues);
    const validation = await runPhase("validation", {}, () =>
      validateTerritoryCountryDatasetPath(countryRoot, { strict: false })
    );
    issues.push(...validation.issues);
    await runPhase("loader-smoke", {}, async () => {
      if (!validation.manifest) {
        throw new Error("Country validation did not return a manifest.");
      }
    });
    const builtLevels = new Set(build.buildReport.statistics.builtLevels);
    const unavailableLevelSet = new Set([
      ...build.buildReport.statistics.unavailableLevels,
      ...sourceUnavailableLevels
    ]);
    const hasBuiltRequestedLevel = input.levels.some((level) => builtLevels.has(level));
    const hasUnavailableRequestedLevel = input.levels.some((level) =>
      unavailableLevelSet.has(level)
    );
    const hasError = issues.some((issue) => issue.severity === "error");
    const hasWarning = issues.some((issue) => issue.severity === "warning");
    const outcome =
      hasError &&
      hasBuiltRequestedLevel &&
      hasUnavailableRequestedLevel &&
      hasOnlySourceUnavailableErrors(issues, unavailableLevelSet)
        ? "partial"
        : hasError
          ? classifyOutcomeFromIssues(issues)
          : hasBuiltRequestedLevel && hasUnavailableRequestedLevel
            ? "partial"
            : hasWarning
              ? "built-with-warnings"
              : "built";

    return createCountryResult({
      config,
      countryRoot: reportCountryRoot,
      sourceLockPath: reportSourceLockPath,
      levels: input.levels,
      outcome,
      status: statusForOutcome(outcome),
      issues,
      buildReport: build.buildReport,
      sourceUnavailableLevels,
      phaseTimings,
      startedAt,
      finishedAt: input.generatedAt
    });
  } catch (error) {
    const outcome = classifyOutcomeFromError(error);

    return createCountryResult({
      config,
      countryRoot: reportCountryRoot,
      sourceLockPath: reportSourceLockPath,
      levels: input.levels,
      outcome,
      status: statusForOutcome(outcome),
      issues: [
        ...issues,
        {
          code: "COUNTRY_BUILD_FAILED",
          severity: "error",
          message: error instanceof Error ? error.message : String(error)
        }
      ],
      phaseTimings,
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
  sourceUnavailableLevels?: readonly TerritoryAdminLevel[];
  phaseTimings: TerritoryCountryBuildPhaseTiming[];
  startedAt: string;
  finishedAt: string;
}): TerritoryCountryBuildAllCountryResult {
  const builtLevels = new Set(input.buildReport?.statistics.builtLevels ?? []);
  const unavailableLevels = new Set([
    ...(input.buildReport?.statistics.unavailableLevels ?? []),
    ...(input.sourceUnavailableLevels ?? [])
  ]);
  const summarizedIssues = summarizeCountryIssues(input.issues);

  return {
    country: input.config.countryCodeAlpha2,
    alpha3: input.config.countryCodeAlpha3,
    provider: input.config.sourceProvider,
    outputPath: input.countryRoot,
    sourceLockPath: input.sourceLockPath,
    levels: input.levels.map((level) => {
      const levelOutcome = createLevelOutcome({
        level,
        countryOutcome: input.outcome,
        builtLevels,
        unavailableLevels,
        issues: input.issues
      });

      return {
        level,
        status: createLevelStatus(levelOutcome),
        outcome: levelOutcome,
        ...(input.buildReport?.statistics.featureCountByLevel[level] !== undefined
          ? { featureCount: input.buildReport.statistics.featureCountByLevel[level] }
          : {}),
        lifecycle: createLevelLifecycle({
          config: input.config,
          level,
          outcome: levelOutcome,
          builtLevels,
          phaseTimings: input.phaseTimings
        }),
        issueCodes: [
          ...new Set(
            input.issues
              .filter((issue) => !issue.level || issue.level === level)
              .map((issue) => issue.code)
          )
        ].sort()
      };
    }),
    outcome: input.outcome,
    issueCount: input.issues.length,
    issues: summarizedIssues.sort(
      (left, right) =>
        (left.level ?? "").localeCompare(right.level ?? "") || left.code.localeCompare(right.code)
    ),
    phaseTimings: input.phaseTimings,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt
  };
}

function summarizeCountryIssues(
  issues: readonly TerritoryCountryBuildIssue[]
): TerritoryCountryBuildIssue[] {
  const grouped = new Map<string, TerritoryCountryBuildIssue>();

  for (const issue of issues) {
    const key = [
      issue.level ?? "",
      issue.zoneId ?? "",
      issue.code,
      issue.severity,
      issue.message
    ].join("\u0000");
    const existing = grouped.get(key);

    if (!existing) {
      grouped.set(key, {
        ...issue,
        details: {
          ...(issue.details ?? {}),
          count: 1
        }
      });
      continue;
    }

    existing.details = {
      ...(existing.details ?? {}),
      count: Number(existing.details?.count ?? 1) + 1
    };
  }

  return [...grouped.values()].map((issue) => {
    if (issue.details?.count !== 1) {
      return issue;
    }

    const { count: _count, ...details } = issue.details;

    if (Object.keys(details).length === 0) {
      const { details: _details, ...withoutDetails } = issue;
      return withoutDetails;
    }

    return { ...issue, details };
  });
}

function createPhaseRunner(input: {
  country: string;
  timeoutMs?: number;
  onPhase?: (event: TerritoryCountryBuildPhaseEvent) => void;
}) {
  return async function runPhase<T>(
    phase: TerritoryCountryBuildPhase,
    details: {
      inputBytes?: number;
      featureCount?: number;
      level?: TerritoryAdminLevel;
      outcome?: TerritoryCountryBuildAllOutcome;
      reason?: string;
    },
    action: () => Promise<T>
  ): Promise<T> {
    const startedAt = new Date().toISOString();
    const started = Date.now();
    input.onPhase?.({
      country: input.country,
      phase,
      status: "started",
      durationMs: 0,
      startedAt,
      ...details
    });

    try {
      const value = await runWithOptionalTimeout(action, input.timeoutMs, phase);
      const timing: TerritoryCountryBuildPhaseTiming = {
        country: input.country,
        phase,
        status: "completed",
        durationMs: Date.now() - started,
        ...details
      };
      input.onPhase?.({
        ...timing,
        startedAt,
        finishedAt: new Date().toISOString()
      });
      return value;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const timing: TerritoryCountryBuildPhaseTiming = {
        country: input.country,
        phase,
        status: "failed",
        durationMs: Date.now() - started,
        reason,
        ...details
      };
      input.onPhase?.({
        ...timing,
        startedAt,
        finishedAt: new Date().toISOString()
      });
      throw error;
    }
  };
}

function createPhaseRecorder(input: {
  phaseTimings: TerritoryCountryBuildPhaseTiming[];
  onPhase?: (event: TerritoryCountryBuildPhaseEvent) => void;
}) {
  return (event: TerritoryCountryBuildPhaseEvent): void => {
    if (event.status !== "started") {
      input.phaseTimings.push({
        country: event.country,
        phase: event.phase,
        status: event.status,
        durationMs: event.durationMs,
        ...(event.inputBytes !== undefined ? { inputBytes: event.inputBytes } : {}),
        ...(event.featureCount !== undefined ? { featureCount: event.featureCount } : {}),
        ...(event.level ? { level: event.level } : {}),
        ...(event.outcome ? { outcome: event.outcome } : {}),
        ...(event.reason ? { reason: event.reason } : {})
      });
    }

    input.onPhase?.(event);
  };
}

function withRequiredAncestorLevels(
  levels: readonly TerritoryAdminLevel[]
): readonly TerritoryAdminLevel[] {
  if (levels.length === 0) {
    return [];
  }

  const deepestRequestedDepth = Math.max(...levels.map(getAdminLevelDepth));

  return TERRITORY_ADMIN_LEVELS.filter(
    (level) => getAdminLevelDepth(level) <= deepestRequestedDepth
  ).sort(compareAdminLevels);
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
  const outcomes = createEmptyOutcomeCounts();

  for (const result of input.results) {
    outcomes[result.outcome] += 1;
  }

  return {
    reportVersion: "1",
    generatedAt: input.generatedAt,
    levels: input.levels,
    countriesAttempted: input.results.length,
    countriesSucceeded: outcomes.built + outcomes["built-with-warnings"],
    countriesFailed: input.results.length - outcomes.built - outcomes["built-with-warnings"],
    outcomes,
    results: input.results
  };
}

function resolveCountryList(
  countries: readonly string[] | undefined,
  excludeCountries: readonly string[] | undefined
) {
  const excluded = new Set(
    (excludeCountries ?? []).map((country) => getTerritoryCountryConfig(country).countryCodeAlpha2)
  );
  const selected =
    !countries || countries.length === 0
      ? listTerritoryCountryConfigs()
      : countries.map((country) => getTerritoryCountryConfig(country));

  return selected.filter((country) => !excluded.has(country.countryCodeAlpha2));
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

function createEmptyOutcomeCounts(): Record<TerritoryCountryBuildAllOutcome, number> {
  return {
    built: 0,
    "built-with-warnings": 0,
    partial: 0,
    "validation-failed": 0,
    "source-unavailable": 0,
    "provider-unsupported": 0,
    "performance-deferred": 0,
    "licence-restricted": 0,
    "provider-error": 0,
    "download-error": 0,
    "extraction-error": 0,
    "parse-error": 0,
    "CRS-error": 0,
    "transform-error": 0,
    "geometry-repair-failed": 0,
    "stable-id-failed": 0,
    "hierarchy-failed": 0,
    "adjacency-failed": 0,
    "index-failed": 0,
    "loader-smoke-failed": 0,
    "mapping-review-required": 0,
    "not-applicable": 0
  };
}

function createLevelOutcome(input: {
  level: TerritoryAdminLevel;
  countryOutcome: TerritoryCountryBuildAllOutcome;
  builtLevels: Set<TerritoryAdminLevel>;
  unavailableLevels: Set<TerritoryAdminLevel>;
  issues: readonly TerritoryCountryBuildIssue[];
}): TerritoryCountryBuildAllOutcome {
  const levelIssues = input.issues.filter((issue) => !issue.level || issue.level === input.level);
  const blockingOutcome = classifyBlockingOutcomeFromIssues(levelIssues);

  if (input.builtLevels.has(input.level)) {
    if (blockingOutcome && blockingOutcome !== "source-unavailable") {
      return blockingOutcome;
    }

    return levelIssues.some((issue) => issue.severity === "warning")
      ? "built-with-warnings"
      : "built";
  }

  if (input.unavailableLevels.has(input.level) || input.countryOutcome === "source-unavailable") {
    return "source-unavailable";
  }

  if (levelIssues.some((issue) => issue.code === "SOURCE_LICENSE_RESTRICTED")) {
    return "licence-restricted";
  }

  if (levelIssues.some((issue) => issue.code === "MAPPING_REVIEW_REQUIRED")) {
    return "mapping-review-required";
  }

  return blockingOutcome ?? input.countryOutcome;
}

function createLevelStatus(outcome: TerritoryCountryBuildAllOutcome): TerritoryArtifactStatus {
  return statusForOutcome(outcome);
}

function createLevelLifecycle(input: {
  config: ReturnType<typeof getTerritoryCountryConfig>;
  level: TerritoryAdminLevel;
  outcome: TerritoryCountryBuildAllOutcome;
  builtLevels: Set<TerritoryAdminLevel>;
  phaseTimings: readonly TerritoryCountryBuildPhaseTiming[];
}): TerritoryCountryLevelLifecycle {
  const built = input.builtLevels.has(input.level);
  const hasPhase = (phase: TerritoryCountryBuildPhase): boolean =>
    input.phaseTimings.some(
      (timing) => timing.phase === phase && (!timing.level || timing.level === input.level)
    );
  const failedPhase = (phase: TerritoryCountryBuildPhase): boolean =>
    input.phaseTimings.some(
      (timing) =>
        timing.phase === phase &&
        timing.status === "failed" &&
        (!timing.level || timing.level === input.level)
    );

  return {
    sourceStatus: sourceLifecycleForOutcome(input.outcome),
    downloadStatus: phaseLifecycle({
      built,
      ran: hasPhase("download"),
      failed: failedPhase("download")
    }),
    transformStatus: phaseLifecycle({
      built,
      ran: hasPhase("parsing") || hasPhase("simplification") || hasPhase("serialization"),
      failed:
        failedPhase("parsing") || failedPhase("simplification") || failedPhase("serialization")
    }),
    repairStatus: phaseLifecycle({
      built,
      ran: hasPhase("geometry-repair"),
      failed: failedPhase("geometry-repair")
    }),
    semanticReviewStatus: semanticReviewLifecycle(
      input.config.levelMappings[input.level]?.reviewStatus
    ),
    hierarchyStatus: phaseLifecycle({
      built,
      ran: hasPhase("derived-metadata"),
      failed: failedPhase("derived-metadata")
    }),
    adjacencyStatus:
      input.level === "ADM0"
        ? "not-run"
        : adjacencyLifecycle({
            built,
            ran: hasPhase("adjacency-generation"),
            failed: failedPhase("adjacency-generation")
          }),
    indexStatus: phaseLifecycle({
      built,
      ran: hasPhase("spatial-index"),
      failed: failedPhase("spatial-index")
    }),
    validationStatus:
      input.outcome === "validation-failed"
        ? "failed"
        : built
          ? "passed"
          : hasPhase("validation")
            ? "passed-with-warnings"
            : "not-run",
    artifactStatus: built
      ? "built"
      : input.outcome === "performance-deferred"
        ? "performance-deferred"
        : input.outcome === "source-unavailable"
          ? "not-attempted"
          : "failed",
    loaderStatus: built ? "passed" : failedPhase("loader-smoke") ? "failed" : "not-run",
    publishStatus:
      input.outcome === "built"
        ? "passed"
        : input.outcome === "built-with-warnings"
          ? "passed-with-warnings"
          : input.outcome === "licence-restricted"
            ? "licence-restricted"
            : built
              ? "passed-with-warnings"
              : "not-run"
  };
}

function semanticReviewLifecycle(
  status: string | undefined
): TerritoryCountryLevelLifecycle["semanticReviewStatus"] {
  switch (status) {
    case "reviewed":
      return "reviewed";
    case "provider-confirmed":
      return "provider-confirmed";
    case "generic-admin-level":
      return "generic-admin-level";
    case "mapping-review-required":
    default:
      return "review-required";
  }
}

function phaseLifecycle(input: {
  built: boolean;
  ran: boolean;
  failed: boolean;
}): TerritoryLifecycleStatus {
  if (input.failed) {
    return "failed";
  }

  if (input.built) {
    return "passed";
  }

  return input.ran ? "passed-with-warnings" : "not-run";
}

function adjacencyLifecycle(input: {
  built: boolean;
  ran: boolean;
  failed: boolean;
}): TerritoryLifecycleStatus {
  if (input.failed) {
    return "failed";
  }

  if (!input.ran) {
    return "not-run";
  }

  return input.built ? "passed" : "not-run";
}

function sourceLifecycleForOutcome(
  outcome: TerritoryCountryBuildAllOutcome
): TerritoryLifecycleStatus {
  if (outcome === "source-unavailable") {
    return "unavailable";
  }

  if (outcome === "provider-error") {
    return "provider-error";
  }

  if (outcome === "provider-unsupported") {
    return "provider-unsupported";
  }

  if (outcome === "licence-restricted") {
    return "licence-restricted";
  }

  if (outcome === "not-applicable") {
    return "not-attempted";
  }

  return "available";
}

function statusForOutcome(outcome: TerritoryCountryBuildAllOutcome): TerritoryArtifactStatus {
  switch (outcome) {
    case "built":
    case "built-with-warnings":
    case "partial":
    case "validation-failed":
    case "source-unavailable":
    case "provider-unsupported":
    case "provider-error":
    case "download-error":
    case "extraction-error":
    case "parse-error":
    case "CRS-error":
    case "transform-error":
    case "geometry-repair-failed":
    case "stable-id-failed":
    case "hierarchy-failed":
    case "adjacency-failed":
    case "index-failed":
    case "performance-deferred":
    case "licence-restricted":
    case "mapping-review-required":
    case "not-applicable":
      return outcome;
    case "loader-smoke-failed":
      return "validation-failed";
  }
}

function classifyOutcomeFromIssues(
  issues: readonly TerritoryCountryBuildIssue[]
): TerritoryCountryBuildAllOutcome {
  const outcome = classifyBlockingOutcomeFromIssues(issues);

  return outcome ?? "validation-failed";
}

function classifyBlockingOutcomeFromIssues(
  issues: readonly TerritoryCountryBuildIssue[]
): TerritoryCountryBuildAllOutcome | undefined {
  const codes = new Set(
    issues.filter((issue) => issue.severity === "error").map((issue) => issue.code)
  );

  if (codes.size === 0) {
    return undefined;
  }

  if (codes.has("SOURCE_LICENSE_RESTRICTED")) {
    return "licence-restricted";
  }

  if (codes.has("IDENTITY_DUPLICATE_TERRITORY_ID")) {
    return "stable-id-failed";
  }

  if (codes.has("GEOMETRY_REPAIR_REJECTED")) {
    return "geometry-repair-failed";
  }

  if (
    codes.has("PARENT_LEVEL_EMPTY") ||
    codes.has("PARENT_UNRESOLVED") ||
    codes.has("PARENT_AMBIGUOUS") ||
    codes.has("PARENT_CONTAINMENT_FAILED")
  ) {
    return "hierarchy-failed";
  }

  if (codes.has("COUNTRY_ADJACENCY_INVALID") || codes.has("ARTIFACT_SELF_ADJACENCY")) {
    return "adjacency-failed";
  }

  if (codes.has("COUNTRY_LEVEL_DATASET_INVALID") || codes.has("COUNTRY_CHECKSUM_MISMATCH")) {
    return "validation-failed";
  }

  if ([...codes].every((code) => SOURCE_UNAVAILABLE_CODES.has(code))) {
    return "source-unavailable";
  }

  return "validation-failed";
}

function hasOnlySourceUnavailableErrors(
  issues: readonly TerritoryCountryBuildIssue[],
  unavailableLevels: ReadonlySet<TerritoryAdminLevel>
): boolean {
  const errors = issues.filter((issue) => issue.severity === "error");

  return (
    errors.length > 0 &&
    errors.every(
      (issue) =>
        !!issue.level &&
        unavailableLevels.has(issue.level) &&
        SOURCE_UNAVAILABLE_CODES.has(issue.code)
    )
  );
}

function classifyOutcomeFromError(error: unknown): TerritoryCountryBuildAllOutcome {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();

  if (normalized.includes("timeout") || normalized.includes("too_large")) {
    return "performance-deferred";
  }

  if (normalized.includes("parse") || normalized.includes("json")) {
    return "parse-error";
  }

  if (normalized.includes("checksum")) {
    return "validation-failed";
  }

  if (
    normalized.includes("fetch") ||
    normalized.includes("download") ||
    normalized.includes("http")
  ) {
    return "download-error";
  }

  if (normalized.includes("adjacency")) {
    return "adjacency-failed";
  }

  if (normalized.includes("loader")) {
    return "loader-smoke-failed";
  }

  return "provider-error";
}

function isSuccessfulOutcome(outcome: TerritoryCountryBuildAllOutcome): boolean {
  return outcome === "built" || outcome === "built-with-warnings";
}

async function runWithOptionalTimeout<T>(
  action: () => Promise<T>,
  timeoutMs: number | undefined,
  phase: TerritoryCountryBuildPhase
): Promise<T> {
  if (!timeoutMs || timeoutMs < 1) {
    return action();
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      action(),
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`${phase} exceeded ${timeoutMs} ms phase timeout.`));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function assertCountryNotTimedOut(timeoutMs: number | undefined, startedAt: number): void {
  if (timeoutMs && timeoutMs > 0 && Date.now() - startedAt > timeoutMs) {
    throw new Error(`country exceeded ${timeoutMs} ms timeout.`);
  }
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
