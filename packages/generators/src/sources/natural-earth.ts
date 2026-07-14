import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { loadTerritoryDataset } from "@territory-kit/dataset";
import {
  NATURAL_EARTH_ADM0_DATASET_NAME,
  NATURAL_EARTH_ADM0_DETAILS,
  NATURAL_EARTH_ADM0_SOURCE_URL,
  NATURAL_EARTH_ATTRIBUTION,
  NATURAL_EARTH_PROVIDER,
  NATURAL_EARTH_PUBLIC_DOMAIN_LICENSE,
  WORLD_COUNTRIES_DATASET_ID,
  createWorldCountriesAdm0ArtifactPlan,
  normalizeNaturalEarthDetails,
  resolveBuildDate
} from "../natural-earth.js";
import type {
  NaturalEarthAdm0BuildOptions,
  NaturalEarthAdm0BuildReport,
  NaturalEarthAdm0BuildResult,
  NaturalEarthAdm0Detail,
  NaturalEarthAdm0Issue,
  NaturalEarthChecksums,
  NaturalEarthSourceDescriptor
} from "../natural-earth.js";
import { TerritorySourceError, createSourceIssue } from "./errors.js";
import { runTerritorySourcePipeline } from "./pipeline.js";
import type {
  TerritorySourceAdapter,
  TerritorySourceArtifact,
  TerritorySourceContext,
  TerritorySourceIssue,
  TerritorySourceTransformResult
} from "./types.js";
import { verifySourceArtifact } from "./verification.js";

export interface NaturalEarthSourceOptions {
  buildDate?: string;
  datasetVersion?: string;
  details?: NaturalEarthAdm0Detail[];
  sourceDate?: string;
  sourceUrl?: string;
  sourceVersion?: string;
}

interface NaturalEarthParsedArtifact {
  input: unknown;
  artifact: TerritorySourceArtifact;
}

export const naturalEarthSourceAdapter: TerritorySourceAdapter<
  NaturalEarthSourceOptions,
  NaturalEarthParsedArtifact
> = {
  id: NATURAL_EARTH_PROVIDER,
  displayName: "Natural Earth",
  supportedAdminLevels: ["ADM0"],
  capabilities: {
    localFile: true,
    remoteFetch: true,
    cache: true,
    attributionRequired: true
  },
  describe() {
    return {
      id: NATURAL_EARTH_PROVIDER,
      displayName: "Natural Earth",
      supportedAdminLevels: ["ADM0"],
      supportedTransports: ["local", "remote"],
      inputFormats: ["GeoJSON FeatureCollection"],
      defaultSourceUrl: NATURAL_EARTH_ADM0_SOURCE_URL,
      defaultLicense: NATURAL_EARTH_PUBLIC_DOMAIN_LICENSE,
      attributionRequired: true,
      sourceVersion: "user-provided",
      options: [
        {
          name: "detail",
          required: false,
          description: "One of low, medium, or high; defaults to all details."
        },
        {
          name: "sourceVersion",
          required: false,
          description: "Natural Earth source release label."
        }
      ],
      exampleCommand:
        "territory import natural-earth --input ./natural-earth.geojson --output ./dist/world-countries"
    };
  },
  validateOptions(options) {
    const issues: TerritorySourceIssue[] = [];

    try {
      normalizeNaturalEarthDetails(options.details);
    } catch (error) {
      issues.push(
        createSourceIssue({
          stage: "resolve",
          code: "SOURCE_OPTIONS_INVALID",
          message: error instanceof Error ? error.message : String(error),
          provider: NATURAL_EARTH_PROVIDER
        })
      );
    }

    return issues;
  },
  fetch(request, context) {
    return context.resolveArtifact(NATURAL_EARTH_PROVIDER, request);
  },
  verify(artifact, context) {
    return verifySourceArtifact(artifact, context, context.request);
  },
  async parse(artifact) {
    try {
      return {
        input: JSON.parse(await readFile(artifact.localPath, "utf8")) as unknown,
        artifact
      };
    } catch (error) {
      throw new TerritorySourceError({
        code: "INVALID_JSON",
        message: error instanceof Error ? error.message : String(error),
        stage: "parse",
        provider: NATURAL_EARTH_PROVIDER,
        details: { sourcePath: artifact.localPath },
        cause: error
      });
    }
  },
  async transform(parsed, options, context) {
    return transformNaturalEarthAdm0(parsed, options, context);
  }
};

export function transformNaturalEarthAdm0(
  parsed: NaturalEarthParsedArtifact,
  options: NaturalEarthSourceOptions,
  context: TerritorySourceContext
): TerritorySourceTransformResult {
  const source = createNaturalEarthSourceDescriptorFromArtifact(parsed.artifact, context, options);
  const plan = createWorldCountriesAdm0ArtifactPlan(parsed.input, {
    buildDate: options.buildDate ?? context.now(),
    ...(options.datasetVersion ? { datasetVersion: options.datasetVersion } : {}),
    ...(options.details ? { details: options.details } : {}),
    source
  });
  const detail = plan.details[0] ?? "high";
  const datasetJson = plan.files.get(`${detail}/dataset.json`) ?? "{}";
  const dataset = loadTerritoryDataset(JSON.parse(datasetJson) as unknown);
  const datasets = Object.fromEntries(
    plan.details.map((currentDetail) => {
      const currentJson = plan.files.get(`${currentDetail}/dataset.json`) ?? "{}";
      return [currentDetail, loadTerritoryDataset(JSON.parse(currentJson) as unknown)];
    })
  );

  return {
    dataset,
    datasets,
    manifestMetadata: plan.manifest,
    attribution: {
      provider: NATURAL_EARTH_PROVIDER,
      text: NATURAL_EARTH_ATTRIBUTION,
      license: NATURAL_EARTH_PUBLIC_DOMAIN_LICENSE,
      ...(source.sourceUrl ? { sourceUrl: source.sourceUrl } : {})
    },
    issues: plan.issues.map((issue) => naturalEarthIssueToSourceIssue(issue)),
    statistics: {
      inputFeatureCount: plan.buildReport.inputFeatureCount,
      acceptedFeatureCount: plan.buildReport.acceptedFeatureCount,
      skippedFeatureCount: plan.buildReport.skippedFeatureCount,
      warningCount: plan.buildReport.warningCount,
      errorCount: plan.buildReport.errorCount,
      duplicateCodeCount: plan.buildReport.duplicateCodeCount,
      fallbackIdCount: plan.buildReport.fallbackIdCount
    },
    files: plan.files,
    manifest: plan.manifest,
    checksums: plan.checksums,
    buildReport: plan.buildReport
  };
}

export async function buildWorldCountriesDatasetFromSourcePipeline(
  options: NaturalEarthAdm0BuildOptions
): Promise<NaturalEarthAdm0BuildResult> {
  const outputPath = resolve(options.outputPath);
  const sourcePath = resolve(options.sourcePath);

  if ((await pathExists(outputPath)) && !options.force) {
    return {
      ok: false,
      outputPath,
      issues: [
        {
          code: "OUTPUT_EXISTS",
          message: `Output path '${outputPath}' already exists.`,
          severity: "error",
          path: outputPath,
          repairSuggestion: "Use --force or choose a new --output directory."
        }
      ]
    };
  }

  const buildDate = resolveBuildDate(options.buildDate, options.env ?? process.env);
  const result = await runTerritorySourcePipeline<NaturalEarthSourceOptions>({
    adapter: naturalEarthSourceAdapter,
    request: {
      input: sourcePath,
      ...(options.sourceSha256 ? { expectedSha256: options.sourceSha256 } : {}),
      ...(options.sourceVersion ? { version: options.sourceVersion } : {})
    },
    options: {
      buildDate,
      ...(options.datasetVersion ? { datasetVersion: options.datasetVersion } : {}),
      ...(options.details ? { details: options.details } : {}),
      ...(options.sourceDate ? { sourceDate: options.sourceDate } : {}),
      ...(options.sourceUrl ? { sourceUrl: options.sourceUrl } : {}),
      ...(options.sourceVersion ? { sourceVersion: options.sourceVersion } : {})
    },
    outputPath,
    ...(options.force ? { force: true } : {}),
    ...(options.strict ? { strict: true } : {}),
    now: () => buildDate
  });
  const issues = result.issues.map((issue) => sourceIssueToNaturalEarthIssue(issue));

  if (!result.ok || !result.transform) {
    return {
      ok: false,
      outputPath,
      issues
    };
  }

  const buildReport = result.transform.buildReport as NaturalEarthAdm0BuildReport | undefined;
  const checksums = result.transform.checksums as NaturalEarthChecksums | undefined;

  return {
    ok: true,
    outputPath,
    issues,
    ...(result.transform.manifest ? { manifest: result.transform.manifest } : {}),
    ...(checksums ? { checksums } : {}),
    ...(buildReport ? { buildReport } : {}),
    summary: {
      datasetId: WORLD_COUNTRIES_DATASET_ID,
      details: options.details ?? [...NATURAL_EARTH_ADM0_DETAILS],
      featureCount: buildReport?.acceptedFeatureCount ?? result.transform.dataset.zones.length,
      warningCount: issues.filter((issue) => issue.severity === "warning").length,
      outputPath,
      checksumsVerified: true
    }
  };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function createNaturalEarthSourceDescriptorFromArtifact(
  artifact: TerritorySourceArtifact,
  context: TerritorySourceContext,
  options: NaturalEarthSourceOptions
): NaturalEarthSourceDescriptor {
  return {
    provider: NATURAL_EARTH_PROVIDER,
    datasetName: NATURAL_EARTH_ADM0_DATASET_NAME,
    version: options.sourceVersion ?? artifact.sourceVersion ?? "unknown",
    sourcePath: artifact.localPath,
    sourceUrl: options.sourceUrl ?? artifact.originalUrl ?? NATURAL_EARTH_ADM0_SOURCE_URL,
    sourceSha256: artifact.sha256,
    license: NATURAL_EARTH_PUBLIC_DOMAIN_LICENSE,
    attribution: NATURAL_EARTH_ATTRIBUTION,
    sourceDate: options.sourceDate ?? options.sourceVersion ?? "unknown",
    importedAt: options.buildDate ?? context.now()
  };
}

function naturalEarthIssueToSourceIssue(issue: NaturalEarthAdm0Issue): TerritorySourceIssue {
  return createSourceIssue({
    stage: "transform",
    severity: issue.severity,
    code: issue.code,
    message: issue.message,
    provider: NATURAL_EARTH_PROVIDER,
    ...(issue.featureId ? { featureId: issue.featureId } : {}),
    ...(issue.sourcePath ? { sourcePath: issue.sourcePath } : {}),
    ...(issue.repairSuggestion ? { repairSuggestion: issue.repairSuggestion } : {}),
    details: {
      ...(issue.path ? { path: issue.path } : {}),
      ...(issue.detail ? { detail: issue.detail } : {}),
      ...(issue.expectedSha256 ? { expectedSha256: issue.expectedSha256 } : {}),
      ...(issue.actualSha256 ? { actualSha256: issue.actualSha256 } : {}),
      ...(issue.territoryId ? { territoryId: issue.territoryId } : {})
    }
  });
}

function sourceIssueToNaturalEarthIssue(issue: TerritorySourceIssue): NaturalEarthAdm0Issue {
  const details = issue.details ?? {};
  const code = issue.code === "SOURCE_INPUT_NOT_FOUND" ? "SOURCE_NOT_FOUND" : issue.code;

  return {
    code,
    message: issue.message,
    severity: issue.severity === "warning" ? "warning" : "error",
    ...(typeof details.path === "string" ? { path: details.path } : {}),
    ...(typeof details.detail === "string"
      ? { detail: details.detail as NaturalEarthAdm0Detail }
      : {}),
    ...(typeof details.expectedSha256 === "string"
      ? { expectedSha256: details.expectedSha256 }
      : {}),
    ...(typeof details.actualSha256 === "string" ? { actualSha256: details.actualSha256 } : {}),
    ...(issue.featureId ? { featureId: issue.featureId } : {}),
    ...(issue.sourcePath ? { sourcePath: issue.sourcePath } : {}),
    ...(typeof details.territoryId === "string" ? { territoryId: details.territoryId } : {}),
    ...(issue.repairSuggestion ? { repairSuggestion: issue.repairSuggestion } : {})
  };
}
