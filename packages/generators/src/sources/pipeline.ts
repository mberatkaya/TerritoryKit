import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { validateGlobalDatasetManifest, validateTerritoryDataset } from "@territory-kit/dataset";
import { createDefaultTerritorySourceRegistry } from "./builtins.js";
import {
  getDefaultSourceCacheDir,
  createSourceCacheKey,
  readCachedSourceArtifact,
  writeSourceCacheEntry
} from "./cache.js";
import { TerritorySourceError, createSourceIssue, issueFromUnknownError } from "./errors.js";
import { resolveFileSourceArtifact } from "./transports/file.js";
import { fetchHttpSourceArtifact } from "./transports/http.js";
import type {
  TerritorySourceAdapter,
  TerritorySourceArtifact,
  TerritorySourceContext,
  TerritorySourceIssue,
  TerritorySourcePipelineEvent,
  TerritorySourcePipelineOptions,
  TerritorySourcePipelineOutput,
  TerritorySourcePipelineResult,
  TerritorySourceRequest,
  TerritorySourceStage,
  TerritorySourceTransformResult
} from "./types.js";
import { pathExists, serializeJsonStable, sha256Hex, writeFilesAtomically } from "./utils.js";

export async function runTerritorySourcePipeline<TOptions = unknown>(
  options: TerritorySourcePipelineOptions<TOptions>
): Promise<TerritorySourcePipelineResult> {
  const events: TerritorySourcePipelineEvent[] = [];
  const issues: TerritorySourceIssue[] = [];
  const registry = options.registry ?? createDefaultTerritorySourceRegistry();
  let provider = typeof options.adapter === "string" ? options.adapter : options.adapter.id;
  let adapter: TerritorySourceAdapter<TOptions>;

  const emit = (event: TerritorySourcePipelineEvent): void => {
    events.push(event);
    options.onEvent?.(event);
  };

  try {
    adapter = await runStage("resolve", provider, emit, async () => {
      const resolvedAdapter =
        typeof options.adapter === "string"
          ? (registry.get(options.adapter) as TerritorySourceAdapter<TOptions>)
          : options.adapter;
      provider = resolvedAdapter.id;
      const optionIssues = resolvedAdapter.validateOptions?.(options.options) ?? [];
      issues.push(...optionIssues);

      return resolvedAdapter;
    });
  } catch (error) {
    issues.push(
      issueFromUnknownError(error, { stage: "resolve", code: "SOURCE_ADAPTER_NOT_FOUND", provider })
    );
    return { ok: false, provider, issues, events };
  }

  if (hasBlockingIssue(issues)) {
    return { ok: false, provider, issues, events };
  }

  const context = createPipelineContext({ ...options, provider });
  let artifact: TerritorySourceArtifact | undefined;
  let transform: TerritorySourceTransformResult | undefined;
  let output: TerritorySourcePipelineOutput | undefined;
  let failedStage: TerritorySourceStage = "complete";
  const stage = <T>(currentStage: TerritorySourceStage, action: () => Promise<T>): Promise<T> => {
    failedStage = currentStage;
    return runStage(currentStage, provider, emit, action);
  };

  try {
    checkAbort(context.signal);
    artifact = await stage("fetch", () => adapter.fetch(options.request, context));
    checkAbort(context.signal);
    const verification = await stage("verify", () =>
      adapter.verify(artifact as TerritorySourceArtifact, context)
    );
    issues.push(...verification.issues);

    if (!verification.ok || hasBlockingIssue(issues)) {
      return { ok: false, provider, issues, events, artifact };
    }

    const parsed = await stage("parse", () =>
      adapter.parse(artifact as TerritorySourceArtifact, options.options, context)
    );
    const normalized = adapter.normalize
      ? await stage(
          "normalize",
          () => adapter.normalize?.(parsed, options.options, context) as Promise<unknown>
        )
      : parsed;
    transform = await stage("transform", () =>
      adapter.transform(normalized as never, options.options, context)
    );
    issues.push(...transform.issues);

    await stage("validate", async () => {
      issues.push(
        ...validateSourceTransform(provider, transform as TerritorySourceTransformResult)
      );
    });
    await stage("enrich", async () => undefined);

    const strictIssues = options.strict
      ? issues
          .filter((issue) => issue.severity === "warning")
          .map((issue) =>
            createSourceIssue({
              ...issue,
              severity: "error",
              code: `STRICT_${issue.code}`,
              message: `Strict mode treats warning as failure: ${issue.message}`
            })
          )
      : [];
    issues.push(...strictIssues);

    if (hasBlockingIssue(issues)) {
      return { ok: false, provider, issues, events, artifact, transform };
    }

    if (options.outputPath) {
      output = await stage("serialize", () =>
        writeSourcePipelineOutput({
          provider,
          outputPath: resolve(options.cwd ?? process.cwd(), options.outputPath as string),
          transform: transform as TerritorySourceTransformResult,
          ...(options.force ? { force: options.force } : {})
        })
      );
    }

    await stage("complete", async () => undefined);

    return {
      ok: true,
      provider,
      issues,
      events,
      artifact,
      transform,
      ...(output ? { output } : {})
    };
  } catch (error) {
    issues.push(
      issueFromUnknownError(error, { stage: failedStage, code: "SOURCE_PIPELINE_FAILED", provider })
    );
    return {
      ok: false,
      provider,
      issues,
      events,
      ...(artifact ? { artifact } : {}),
      ...(transform ? { transform } : {})
    };
  }
}

function createPipelineContext<TOptions>(
  options: TerritorySourcePipelineOptions<TOptions> & { provider: string }
): TerritorySourceContext {
  const cwd = options.cwd ?? process.cwd();
  const maxSourceSizeBytes = options.maxSourceSizeBytes ?? 100 * 1024 * 1024;
  const cache = {
    enabled: !(options.noCache ?? false) && (options.cache?.enabled ?? true),
    ...(options.cache?.directory ? { directory: resolve(cwd, options.cache.directory) } : {})
  };

  return {
    cwd,
    request: options.request,
    ...(options.signal ? { signal: options.signal } : {}),
    maxSourceSizeBytes,
    cache,
    now: options.now ?? (() => new Date().toISOString()),
    resolveArtifact(provider, request) {
      return resolveSourceArtifact({
        provider,
        request,
        cwd,
        maxSourceSizeBytes,
        cache,
        ...(options.signal ? { signal: options.signal } : {}),
        now: options.now ?? (() => new Date().toISOString())
      });
    }
  };
}

async function resolveSourceArtifact(options: {
  provider: string;
  request: TerritorySourceRequest;
  cwd: string;
  maxSourceSizeBytes: number;
  cache: { enabled: boolean; directory?: string };
  signal?: AbortSignal;
  now: () => string;
}): Promise<TerritorySourceArtifact> {
  if (options.request.input && options.request.url) {
    throw new Error("Use either source input or source URL, not both.");
  }

  if (options.request.input) {
    return resolveFileSourceArtifact({
      provider: options.provider,
      request: options.request,
      cwd: options.cwd,
      maxSourceSizeBytes: options.maxSourceSizeBytes
    });
  }

  if (!options.request.url) {
    throw new Error("A source input path or URL is required.");
  }

  const cacheDir = options.cache.directory ?? getDefaultSourceCacheDir();
  const cacheKey = createSourceCacheKey(options.provider, options.request);

  if (options.cache.enabled && !options.request.refresh) {
    const cached = await readCachedSourceArtifact({
      provider: options.provider,
      cacheDir,
      cacheKey,
      request: options.request
    });
    const blockingIssue = cached.issues.find((issue) => issue.severity === "error");

    if (blockingIssue) {
      throw new Error(blockingIssue.message);
    }

    if (cached.artifact) {
      return cached.artifact;
    }
  }

  const tempDownloadDir = options.cache.enabled
    ? join(cacheDir, options.provider, `${cacheKey}.download`)
    : undefined;

  if (tempDownloadDir) {
    await mkdir(tempDownloadDir, { recursive: true });
  }

  const downloaded = await fetchHttpSourceArtifact({
    provider: options.provider,
    url: options.request.url,
    ...(tempDownloadDir ? { destinationDirectory: tempDownloadDir } : {}),
    ...(options.request.expectedSha256 ? { expectedSha256: options.request.expectedSha256 } : {}),
    ...(options.request.version ? { sourceVersion: options.request.version } : {}),
    maxSourceSizeBytes: options.maxSourceSizeBytes,
    ...(options.signal ? { signal: options.signal } : {}),
    now: options.now
  });

  if (!options.cache.enabled) {
    return downloaded;
  }

  const cachedArtifact = await writeSourceCacheEntry({
    provider: options.provider,
    cacheDir,
    cacheKey,
    artifact: downloaded
  });

  return cachedArtifact;
}

async function writeSourcePipelineOutput(options: {
  provider: string;
  outputPath: string;
  transform: TerritorySourceTransformResult;
  force?: boolean;
}): Promise<TerritorySourcePipelineOutput> {
  if ((await pathExists(options.outputPath)) && !options.force) {
    throw new TerritorySourceError({
      code: "OUTPUT_EXISTS",
      message: `Output path '${options.outputPath}' already exists.`,
      stage: "serialize",
      provider: options.provider,
      details: { outputPath: options.outputPath }
    });
  }

  const files = options.transform.files ?? createGenericArtifactFiles(options.transform);
  await writeFilesAtomically(options.outputPath, files, {
    ...(options.force ? { force: options.force } : {})
  });

  return {
    outputPath: options.outputPath,
    files: Object.fromEntries(
      [...files.entries()]
        .map(([filePath, content]) => [filePath, sha256Hex(content)] as const)
        .sort(([left], [right]) => left.localeCompare(right))
    )
  };
}

function createGenericArtifactFiles(
  transform: TerritorySourceTransformResult
): Map<string, string> {
  const files = new Map<string, string>();
  files.set("dataset.json", serializeJsonStable(transform.dataset));
  files.set("manifest.json", serializeJsonStable(transform.dataset.manifest));
  files.set("attribution.txt", `${transform.attribution.text}\n`);
  files.set(
    "build-report.json",
    serializeJsonStable({
      statistics: transform.statistics,
      issues: transform.issues,
      buildDurationMs: 0,
      buildDurationPolicy: "normalized-for-reproducibility"
    })
  );
  const checksums = Object.fromEntries(
    [...files.entries()].map(([filePath, content]) => [filePath, sha256Hex(content)] as const)
  );
  files.set(
    "checksums.json",
    serializeJsonStable({
      algorithm: "sha256",
      files: Object.fromEntries(
        Object.entries(checksums).sort(([left], [right]) => left.localeCompare(right))
      )
    })
  );

  return files;
}

function validateSourceTransform(
  provider: string,
  transform: TerritorySourceTransformResult
): TerritorySourceIssue[] {
  const issues: TerritorySourceIssue[] = [];
  const datasets = transform.datasets ? Object.values(transform.datasets) : [transform.dataset];

  for (const dataset of datasets) {
    const validation = validateTerritoryDataset(dataset);

    issues.push(
      ...validation.issues.map((issue) =>
        createSourceIssue({
          stage: "validate",
          severity: issue.severity,
          code: `DATASET_${issue.code}`,
          message: issue.message,
          provider,
          ...(issue.featureId ? { featureId: issue.featureId } : {}),
          ...(issue.sourcePath ? { sourcePath: issue.sourcePath } : {}),
          ...(issue.repairSuggestion ? { repairSuggestion: issue.repairSuggestion } : {}),
          details: { path: issue.path, zoneId: issue.zoneId }
        })
      )
    );
  }

  if (transform.manifest) {
    const manifestValidation = validateGlobalDatasetManifest(transform.manifest);
    issues.push(
      ...manifestValidation.issues.map((issue) =>
        createSourceIssue({
          stage: "validate",
          code: `MANIFEST_${issue.code}`,
          message: issue.message,
          provider,
          details: { path: issue.path }
        })
      )
    );
  }

  return issues;
}

async function runStage<T>(
  stage: TerritorySourceStage,
  provider: string,
  emit: (event: TerritorySourcePipelineEvent) => void,
  action: () => Promise<T>
): Promise<T> {
  const startedAt = performance.now();
  emit({ stage, status: "started", provider });

  try {
    const result = await action();
    emit({
      stage,
      status: "completed",
      provider,
      durationMs: Math.round(performance.now() - startedAt)
    });
    return result;
  } catch (error) {
    emit({
      stage,
      status: "failed",
      provider,
      durationMs: Math.round(performance.now() - startedAt)
    });
    throw error;
  }
}

function hasBlockingIssue(issues: readonly TerritorySourceIssue[]): boolean {
  return issues.some((issue) => issue.severity === "error");
}

function checkAbort(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new Error("Source pipeline was aborted.");
  }
}
