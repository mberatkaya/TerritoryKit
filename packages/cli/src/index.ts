#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createTerritoryEngine,
  encodeTerritoryBinarySpatialIndex,
  inspectTerritoryBinarySpatialIndex,
  validateTerritoryBinarySpatialIndex
} from "@territory-kit/core";
import {
  TERRITORY_ADMIN_LEVELS,
  TERRITORY_SCHEMA_VERSION,
  createMigrationPlan,
  createTerritoryAdjacencyIndex,
  createTerritoryDatasetFromGeoJson,
  diffDatasets,
  diffIdentities,
  loadTerritoryDataset,
  validateMigrationPlan,
  validateTerritoryDataset,
  validateGeometryDataset
} from "@territory-kit/dataset";
import { validateTurkeyV2Dataset } from "@territory-kit/dataset/turkey-v2";
import type {
  TerritoryCoverageChangeReport,
  TerritoryDatasetDiffReport,
  TerritoryDatasetMigrationPlan,
  GeometryQualityCheckPreset,
  GeometryQualityOptions,
  GeometryRepairOptions,
  GeometryRepairStrategy,
  TerritoryAdminLevel,
  TerritoryAdjacencyBuildOptions,
  TerritoryAdjacencyType,
  TerritoryDataset,
  TerritoryDatasetManifest,
  TerritoryGeoJsonImportOptions,
  TerritoryValidationIssue,
  TerritoryZone
} from "@territory-kit/dataset";
import {
  NATURAL_EARTH_ADM0_DETAILS,
  WORLD_COUNTRIES_DATASET_ID,
  GLOBAL_ADMIN_ADM0_OUTPUT,
  GLOBAL_ADMIN_DATASET_ID,
  NATURAL_EARTH_ADM0_GEOJSON_URL,
  buildAllTerritoryCountryDatasets,
  buildGlobalAdminAdm0Artifacts,
  buildTerritoryAdjacencyPath,
  buildTerritoryAdjacency,
  buildTerritoryCoverageRegistryFromArtifacts,
  buildTerritoryCountryDatasetPath,
  buildWorldCountriesDatasetFromSourcePipeline,
  createTerritoryCountrySourceLock,
  createDatasetGeometryHash,
  createSyntheticGridDataset,
  createWeightedVoronoiDataset,
  getTerritorySourceAdapter,
  getTerritoryCountryConfig,
  hasTerritorySourceAdapter,
  inspectTerritorySourceCapabilities,
  inspectTerritoryCountryDatasetPath,
  listTerritoryCountryConfigs,
  inferBBoxAdjacency,
  inferBBoxAdjacencyConnections,
  listTerritorySourceAdapters,
  readTerritoryCountrySourceLockPath,
  readTerritoryAdjacencyArtifactPath,
  repairTerritoryDatasetPath,
  simplifyTerritoryDatasetPath,
  buildTerritoryRenderArtifactPath,
  buildTerritoryRenderArtifacts,
  compareTerritoryQueryRenderArtifacts,
  runTerritorySourcePipeline,
  inspectTerritoryRenderArtifactPath,
  validateTerritoryCountryDatasetPath,
  verifyTerritoryCountrySourceLock,
  validateTerritoryAdjacencyPath,
  validateTerritoryDatasetPath,
  validateTerritoryRenderArtifactPath,
  writeGeometryQualityReport
} from "@territory-kit/generators";
import {
  buildTurkeyAdm3GeneratedZones,
  buildTurkeyAdm3EffectiveZones,
  buildTurkeyGameZonesWithAdjacency,
  createTurkeyGameZoneDataset,
  createTurkeyAdm3ProviderHealthReport,
  createTurkeyAdm3Registry,
  inspectTurkeyAdm3SpatialQuality,
  validateTurkeyGameZoneGeneratorOptions,
  resolveTurkeyAdm3Provider,
  validateTurkeyAdm3ProviderRegistry
} from "@territory-kit/generators/turkey-adm3";
import { validateTerritoryDatasetRegistry } from "@territory-kit/registry";
import {
  buildTerritoryDatasetRegistryFromArtifacts,
  createLocalTerritoryRegistryPublishTarget,
  createNodeTerritoryRegistryCache,
  createNodeTerritoryRegistryClient,
  publishTerritoryDatasetRegistry,
  verifyTerritoryRegistryPublication,
  readRegistryFile
} from "@territory-kit/registry/node";
import type {
  GenericGeoJsonSourceOptions,
  GeoBoundariesSourceOptions,
  HdxCodAbSourceOptions,
  NaturalEarthAdm0Detail,
  NaturalEarthSourceOptions,
  TerritoryProviderCapabilitiesResult,
  TerritorySourceDescription,
  TerritorySourceIssue,
  TerritorySourcePipelineResult,
  TerritorySourceRequest
} from "@territory-kit/generators";
import type {
  computeTurkeyAdm3DistrictCoverage,
  TurkeyAdm3FallbackRegistry,
  TurkeyGameZoneFragmentStrategy,
  TurkeyGameZoneGeneratorOptions,
  TurkeyGameZoneProfile,
  TurkeyAdm3ProviderRecord
} from "@territory-kit/generators/turkey-adm3";

interface CliIssue {
  code: string;
  message: string;
  column?: number;
  featureId?: string;
  line?: number;
  path?: string;
  repairSuggestion?: string;
  severity: "error" | "warning";
  sourcePath?: string;
  zoneId?: string;
}

interface JsonSource {
  input: unknown;
  lineIndex: JsonLineIndex;
}

interface JsonLineIndex {
  findLineForIssue(issue: TerritoryValidationIssue): number | undefined;
}

interface CliBenchmarkResult {
  schemaVersion: "territorykit-benchmark-result@1";
  mode: "fixture" | "local-real";
  scenario: string;
  generatedAt: string;
  runtime: {
    node: string;
    platform: string;
    arch: string;
  };
  source: Record<string, unknown>;
  inputs: {
    datasetId?: string;
    datasetVersion?: string;
    featureCount: number;
    iterations?: number;
  };
  metrics: Record<string, number>;
  skipped?: string[];
}

interface CliCountryBuildPhaseEvent {
  country: string;
  phase: string;
  status: "started" | "completed" | "failed" | "skipped";
  durationMs: number;
  inputBytes?: number;
  outputBytes?: number;
  featureCount?: number;
  peakMemoryBytes?: number;
  artifactCount?: number;
  warningCount?: number;
  errorCount?: number;
  level?: TerritoryAdminLevel;
  outcome?: string;
  reason?: string;
  startedAt: string;
  completedAt?: string;
  finishedAt?: string;
}

type CliCountryBuildResult = Awaited<ReturnType<typeof buildTerritoryCountryDatasetPath>>;

interface CliDiffRunOptions {
  identityOnly?: boolean;
}

const CLI_WORKSPACE_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<number> {
  const [command] = argv;

  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return 0;
  }

  try {
    if (command === "dataset") {
      return await runDataset(argv.slice(1));
    }

    if (command === "identity") {
      return await runIdentity(argv.slice(1));
    }

    if (command === "registry") {
      return await runRegistry(argv.slice(1));
    }

    if (command === "cache") {
      return await runCache(argv.slice(1));
    }

    if (command === "source" || command === "sources") {
      return await runSource(argv.slice(1));
    }

    if (command === "import") {
      return await runImportCommand(argv.slice(1));
    }

    if (command === "geometry") {
      return await runGeometry(argv.slice(1));
    }

    if (command === "adjacency") {
      return await runAdjacency(argv.slice(1));
    }

    if (command === "render") {
      return await runRender(argv.slice(1));
    }

    if (command === "benchmark") {
      return await runBenchmark(argv.slice(1));
    }

    if (command === "country") {
      return await runCountry(argv.slice(1));
    }

    if (command === "tr") {
      return await runTurkey(argv.slice(1));
    }

    if (command === "generate") {
      return await runGenerate(argv.slice(1));
    }

    if (command === "index") {
      return await runIndex(argv.slice(1));
    }

    const commandArgs = argv.slice(1);
    const commandFlags = parseFlags(commandArgs);
    const [filePath] = getPositionalArgs(commandArgs);

    if (!filePath) {
      printJson({
        ok: false,
        command,
        issues: [createCliIssue(`Missing input path for command '${command}'.`)]
      });
      return 1;
    }

    const input = await readJson(filePath);

    if (command === "validate") {
      const profile = getFlag(commandFlags, "profile");

      if (profile && profile !== "tr-v2") {
        printJson({
          ok: false,
          command,
          issues: [
            createCliIssue(`Unsupported validation profile '${profile}'.`, {
              code: "VALIDATION_PROFILE_UNSUPPORTED"
            })
          ]
        });
        return 2;
      }

      const result =
        profile === "tr-v2" ? validateTurkeyV2Dataset(input) : validateTerritoryDataset(input);

      printJson({
        ok: result.ok,
        command,
        ...(profile ? { profile } : {}),
        ...(result.ok ? { data: { issues: result.issues } } : { issues: result.issues })
      });
      return result.ok ? 0 : 1;
    }

    const dataset = loadTerritoryDataset(input);

    if (command === "simplify") {
      printJson({
        ok: true,
        command,
        data: {
          ...dataset,
          manifest: {
            ...dataset.manifest,
            geometryHash: createDatasetGeometryHash(dataset)
          }
        }
      });
      return 0;
    }

    printJson({
      ok: false,
      command,
      issues: [createCliIssue(`Unknown command '${command}'.`)]
    });
    return 1;
  } catch (error) {
    printJson({
      ok: false,
      command,
      issues: [createCliIssue(error instanceof Error ? error.message : String(error))]
    });
    return 1;
  }
}

async function runIndex(args: string[]): Promise<number> {
  const [subcommand] = args;

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printIndexHelp();
    return 0;
  }

  if (subcommand === "build") {
    return runIndexBuild(args.slice(1));
  }

  if (subcommand === "inspect") {
    return runIndexInspect(args.slice(1));
  }

  if (subcommand === "validate") {
    return runIndexValidate(args.slice(1));
  }

  return runIndexSummary(args);
}

async function runIndexSummary(args: string[]): Promise<number> {
  const [filePath] = getPositionalArgs(args);

  if (!filePath) {
    printJson({
      ok: false,
      command: "index",
      issues: [createCliIssue("Missing dataset path for index summary.")]
    });
    return 1;
  }

  const dataset = loadTerritoryDataset(await readJson(filePath));
  const engine = createTerritoryEngine({ dataset });

  printJson({
    ok: true,
    command: "index",
    data: {
      datasetId: dataset.manifest.datasetId,
      geometryHash: createDatasetGeometryHash(dataset),
      levels: engine.availableLevels,
      zoneCount: dataset.zones.length,
      spatialIndex: engine.getSpatialIndexSummary()
    }
  });
  return 0;
}

async function runIndexBuild(args: string[]): Promise<number> {
  const flags = parseFlags(args);
  const [datasetPath] = getPositionalArgs(args);
  const outputPath = getFlag(flags, "output") ?? getFlag(flags, "out");

  if (!datasetPath || !outputPath) {
    printJson({
      ok: false,
      command: "index build",
      issues: [createCliIssue("Usage: territory index build <dataset.json> --output <index.tksi>.")]
    });
    return 1;
  }

  const dataset = loadTerritoryDataset(await readJson(datasetPath));
  const buffer = encodeTerritoryBinarySpatialIndex(dataset);
  await writeBinaryOutput(outputPath, buffer, flags.has("force"));
  const metadata = inspectTerritoryBinarySpatialIndex(buffer);

  printJson({
    ok: true,
    command: "index build",
    data: {
      outputPath,
      ...metadata
    }
  });
  return 0;
}

async function runIndexInspect(args: string[]): Promise<number> {
  const [indexPath] = getPositionalArgs(args);

  if (!indexPath) {
    printJson({
      ok: false,
      command: "index inspect",
      issues: [createCliIssue("Usage: territory index inspect <index.tksi>.")]
    });
    return 1;
  }

  const metadata = inspectTerritoryBinarySpatialIndex(await readBinary(indexPath));

  printJson({
    ok: true,
    command: "index inspect",
    data: metadata
  });
  return 0;
}

async function runIndexValidate(args: string[]): Promise<number> {
  const flags = parseFlags(args);
  const [indexPath] = getPositionalArgs(args);

  if (!indexPath) {
    printJson({
      ok: false,
      command: "index validate",
      issues: [
        createCliIssue("Usage: territory index validate <index.tksi> [--dataset <dataset.json>].")
      ]
    });
    return 1;
  }

  const datasetPath = getFlag(flags, "dataset");
  const dataset = datasetPath ? loadTerritoryDataset(await readJson(datasetPath)) : undefined;
  const result = validateTerritoryBinarySpatialIndex(await readBinary(indexPath), {
    ...(dataset
      ? {
          datasetId: dataset.manifest.datasetId,
          datasetVersion: dataset.manifest.datasetVersion,
          geometryHash: dataset.manifest.geometryHash
        }
      : {})
  });

  printJson({
    ok: result.ok,
    command: "index validate",
    ...(result.ok ? { data: result.metadata } : { issues: result.issues })
  });
  return result.ok ? 0 : 1;
}

async function runCountry(args: string[]): Promise<number> {
  const [subcommand] = args;

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printCountryHelp();
    return 0;
  }

  if (subcommand === "list") {
    return runCountryList(args.slice(1));
  }

  if (subcommand === "info") {
    return runCountryInfo(args.slice(1));
  }

  if (subcommand === "source") {
    return runCountrySource(args.slice(1));
  }

  if (subcommand === "source-lock") {
    return runCountrySourceLock(args.slice(1));
  }

  if (subcommand === "source-verify") {
    return runCountrySourceVerify(args.slice(1));
  }

  if (subcommand === "build") {
    return runCountryBuild(args.slice(1));
  }

  if (subcommand === "validate") {
    return runCountryValidate(args.slice(1));
  }

  if (subcommand === "inspect") {
    return runCountryInspect(args.slice(1));
  }

  printJson({
    ok: false,
    command: "country",
    issues: [createCliIssue(`Unsupported country command '${subcommand}'.`)]
  });
  return 2;
}

async function runTurkey(args: string[]): Promise<number> {
  const [subcommand] = args;

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printTurkeyHelp();
    return 0;
  }

  if (subcommand === "adm3") {
    return runTurkeyAdm3(args.slice(1));
  }

  printJson({
    ok: false,
    command: "tr",
    issues: [createCliIssue(`Unsupported Turkey command '${subcommand}'.`)]
  });
  return 2;
}

async function runTurkeyAdm3(args: string[]): Promise<number> {
  const [subcommand] = args;

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printTurkeyAdm3Help();
    return 0;
  }

  if (subcommand === "providers") {
    return runTurkeyAdm3Providers(args.slice(1));
  }

  if (subcommand === "coverage") {
    return runTurkeyAdm3Coverage(args.slice(1));
  }

  if (subcommand === "source-audit") {
    return runTurkeyAdm3SourceAudit(args.slice(1));
  }

  if (subcommand === "plan") {
    return runTurkeyAdm3Plan(args.slice(1));
  }

  if (subcommand === "build") {
    return runTurkeyAdm3Build(args.slice(1));
  }

  if (subcommand === "generate") {
    return runTurkeyAdm3Generate(args.slice(1));
  }

  printJson({
    ok: false,
    command: "tr adm3",
    issues: [createCliIssue(`Unsupported Turkey ADM3 command '${subcommand}'.`)]
  });
  return 2;
}

async function runTurkeyAdm3Providers(args: string[]): Promise<number> {
  const [subcommand] = args;

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printTurkeyAdm3ProvidersHelp();
    return 0;
  }

  if (subcommand === "list") {
    const flags = parseFlags(args.slice(1));
    const records = await readTurkeyAdm3ProviderRecords(flags);
    const providerClass = getFlag(flags, "class");
    const filtered = providerClass
      ? records.filter((record) => record.providerClass === providerClass)
      : records;
    const registry = createTurkeyAdm3Registry({
      providers: filtered,
      experimentalSources: flags.has("allow-experimental") || flags.has("experimental-sources"),
      generatedAt: getFlag(flags, "build-date") ?? new Date(0).toISOString()
    });

    printJson({
      ok: true,
      command: "tr adm3 providers list",
      data: {
        summary: validateTurkeyAdm3ProviderRegistry({ providers: registry.records }).summary,
        records: registry.records
      }
    });
    return 0;
  }

  if (subcommand === "health") {
    const flags = parseFlags(args.slice(1));
    const records = await readTurkeyAdm3ProviderRecords(flags);
    const checkedAt = getFlag(flags, "build-date") ?? new Date().toISOString();
    const health = flags.has("network")
      ? await createTurkeyAdm3ProviderNetworkHealthReport({ providers: records, checkedAt })
      : createTurkeyAdm3ProviderHealthReport({ providers: records, checkedAt });
    const outputPath = getFlag(flags, "output");
    const payload = {
      schemaVersion: "territorykit-tr-adm3-source-health@1",
      country: "TR",
      generatedAt: checkedAt,
      networkMode: flags.has("network") ? "network" : "offline-registry",
      health
    };

    if (outputPath) {
      await writeJsonOutput(outputPath, payload, flags.has("force"));
    }

    printJson({ ok: true, command: "tr adm3 providers health", data: payload });
    return 0;
  }

  printJson({
    ok: false,
    command: "tr adm3 providers",
    issues: [createCliIssue(`Unsupported Turkey ADM3 providers command '${subcommand}'.`)]
  });
  return 2;
}

async function runTurkeyAdm3Coverage(args: string[]): Promise<number> {
  const flags = parseFlags(args);
  const coveragePath =
    getFlag(flags, "coverage") ?? cliWorkspacePath("reports/tr-adm3/national-coverage.json");
  const coverage = await readJson(coveragePath);

  printJson({ ok: true, command: "tr adm3 coverage", data: coverage });
  return 0;
}

async function runTurkeyAdm3SourceAudit(args: string[]): Promise<number> {
  const flags = parseFlags(args);
  const records = await readTurkeyAdm3ProviderRecords(flags);
  const fallbacks = await readTurkeyAdm3FallbackRegistry(flags);
  const validation = validateTurkeyAdm3ProviderRegistry({ providers: records, fallbacks });

  printJson({
    ok: validation.ok,
    command: "tr adm3 source-audit",
    data: validation.summary,
    issues: validation.issues
  });
  return validation.ok ? 0 : 1;
}

async function runTurkeyAdm3Plan(args: string[]): Promise<number> {
  const flags = parseFlags(args);
  const records = await readTurkeyAdm3ProviderRecords(flags);
  const fallbacks = await readTurkeyAdm3FallbackRegistry(flags);
  const sourceModes = {
    official: flags.has("official") || getFlag(flags, "source") === "official",
    runtime: flags.has("allow-runtime"),
    experimental: flags.has("allow-experimental"),
    osm: flags.has("osm") || getFlag(flags, "source") === "osm",
    generated: flags.has("generated") || flags.has("allow-generated") || flags.has("fill-gaps")
  };
  const resolvedDistricts = fallbacks.districts.map((district) => {
    const provider = resolveTurkeyAdm3Provider({
      countryCode: "TR",
      provinceCode: district.provinceCode,
      districtCode: district.districtId,
      providers: records,
      allowOfficial: sourceModes.official || !getFlag(flags, "source"),
      allowRuntime: sourceModes.runtime,
      allowExperimental: sourceModes.experimental,
      allowOsm: sourceModes.osm || !getFlag(flags, "source"),
      allowGenerated: sourceModes.generated || !getFlag(flags, "source")
    });

    return {
      districtId: district.districtId,
      provinceCode: district.provinceCode,
      providerId: provider?.id,
      providerClass: provider?.providerClass
    };
  });
  const payload = {
    schemaVersion: "territorykit-tr-adm3-build-plan@1",
    country: "TR",
    generatedAt: getFlag(flags, "build-date") ?? new Date().toISOString(),
    sourceModes,
    districtCount: resolvedDistricts.length,
    resolvedDistricts,
    coverageTargetPercent: 99.99
  };
  const outputPath = getFlag(flags, "output");

  if (outputPath) {
    await writeJsonOutput(outputPath, payload, flags.has("force"));
  }

  printJson({ ok: true, command: "tr adm3 plan", data: payload });
  return 0;
}

async function runTurkeyAdm3Build(args: string[]): Promise<number> {
  const startedAt = performance.now();
  const flags = parseFlags(args);
  const records = await readTurkeyAdm3ProviderRecords(flags);
  const fallbacks = await readTurkeyAdm3FallbackRegistry(flags);
  const generatedAt = getFlag(flags, "build-date") ?? new Date().toISOString();
  const sourceModes = {
    official: flags.has("official") || getFlag(flags, "source") === "official",
    runtime: flags.has("allow-runtime"),
    experimental: flags.has("allow-experimental"),
    osm: flags.has("osm") || getFlag(flags, "source") === "osm",
    generated: flags.has("generated") || flags.has("allow-generated") || flags.has("fill-gaps")
  };
  const adm2DatasetPath =
    getFlag(flags, "adm2-dataset") ??
    cliWorkspacePath("datasets/generated/countries/TR/dataset.json");
  const officialArtifactPath = getFlag(flags, "official-artifact");
  const runtimeArtifactPath = getFlag(flags, "runtime-artifact");
  const osmArtifactPath = getFlag(flags, "osm-artifact");
  const flagIssues: CliIssue[] = [];
  const districtLimit = readOptionalPositiveIntegerFlag(flags, "max-districts", flagIssues);

  if (flagIssues.length > 0) {
    printJson({ ok: false, command: "tr adm3 build", issues: flagIssues });
    return 2;
  }

  const output = getFlag(flags, "output") ?? cliWorkspacePath(".territory/build/TR/ADM3");
  const outputIsJson = output.endsWith(".json");
  const artifactRoot = outputIsJson ? dirname(output) : output;
  const summaryPath = outputIsJson ? output : join(artifactRoot, "build-summary.json");
  const datasetPath = join(artifactRoot, "dataset.json");
  const coverageReportPath = join(artifactRoot, "coverage.json");
  const qualityReportPath = join(artifactRoot, "geometry-quality.json");
  const datasetId = "territory-kit-tr-adm3-national-build";
  const force = flags.has("force");
  const adm2Zones = await readTurkeyAdm3Adm2Zones(adm2DatasetPath);
  const adm2ById = new Map(adm2Zones.map((zone) => [zone.id, zone]));
  const officialByParent = groupTurkeyAdm3ZonesByParent(
    sourceModes.official ? await readTurkeyAdm3Adm3Zones(officialArtifactPath) : []
  );
  const runtimeByParent = groupTurkeyAdm3ZonesByParent(
    sourceModes.runtime ? await readTurkeyAdm3Adm3Zones(runtimeArtifactPath) : []
  );
  const osmByParent = groupTurkeyAdm3ZonesByParent(
    sourceModes.osm ? await readTurkeyAdm3Adm3Zones(osmArtifactPath) : []
  );
  const selectedDistricts = fallbacks.districts
    .map((district) => ({ fallback: district, zone: adm2ById.get(district.districtId) }))
    .filter(
      (
        entry
      ): entry is {
        fallback: TurkeyAdm3FallbackRegistry["districts"][number];
        zone: TerritoryZone;
      } => Boolean(entry.zone)
    )
    .slice(0, districtLimit ?? undefined);
  const finalZones: TerritoryZone[] = [];
  const districtReports: TurkeyAdm3BuildDistrictCoverage[] = [];

  for (const { fallback, zone: district } of selectedDistricts) {
    const officialZones = officialByParent.get(district.id) ?? [];
    const runtimeZones = runtimeByParent.get(district.id) ?? [];
    const osmZones = osmByParent.get(district.id) ?? [];
    const realZones = [...officialZones, ...runtimeZones, ...osmZones];
    const generated = sourceModes.generated
      ? buildTurkeyAdm3GeneratedZones({
          district,
          provinceCode: fallback.provinceCode,
          realZones
        }).zones
      : [];
    const effective = buildTurkeyAdm3EffectiveZones({
      district,
      provinceCode: fallback.provinceCode,
      officialZones,
      runtimeZones,
      osmZones,
      generatedZones: generated
    });

    finalZones.push(
      ...effective.zones.map((sourceZone) => normalizeTurkeyAdm3BuildZone(sourceZone, datasetId))
    );
    districtReports.push({
      ...effective.coverage,
      districtName: fallback.districtName,
      provinceName: fallback.provinceName
    });
  }

  const baseDataset: TerritoryDataset = {
    manifest: {
      schemaVersion: TERRITORY_SCHEMA_VERSION,
      datasetId,
      datasetVersion: "0.0.0",
      sourceDate: generatedAt,
      buildDate: generatedAt,
      geometryHash: createDatasetGeometryHash({ zones: finalZones }),
      adminLevels: ["ADM3"],
      countryCodes: ["TR"],
      crs: "EPSG:4326",
      geometryDetail: "source",
      license: "mixed",
      name: "Turkey ADM3-like national build",
      sourceProvider: "TerritoryKit Turkey ADM3 real build pipeline",
      boundaryPolicy: "official-runtime-osm-generated-priority",
      disputedAreaPolicy: "source",
      worldview: "TR"
    },
    zones: finalZones
  };
  const adjacency = await buildTerritoryAdjacency(baseDataset, {
    buildDate: generatedAt,
    includePointTouches: true,
    qualityChecks: {
      coordinates: true,
      rings: true,
      selfIntersections: false,
      holes: false,
      bbox: true,
      center: false,
      antimeridian: true,
      parentContainment: false,
      siblingOverlaps: false
    },
    sameAdminLevelOnly: true,
    sameParentOnly: false,
    minimumSharedBoundaryMeters: 0.001
  });
  const dataset: TerritoryDataset = {
    ...baseDataset,
    manifest: {
      ...baseDataset.manifest,
      geometryHash: createDatasetGeometryHash({
        zones: addTurkeyAdm3NeighborsFromAdjacency(baseDataset.zones, adjacency.artifact.edges)
      })
    },
    zones: addTurkeyAdm3NeighborsFromAdjacency(baseDataset.zones, adjacency.artifact.edges)
  };
  const validation = validateGeometryDataset(dataset, {
    checks: {
      coordinates: true,
      rings: true,
      selfIntersections: true,
      holes: true,
      bbox: true,
      center: false,
      antimeridian: true,
      parentContainment: false,
      siblingOverlaps: false
    }
  });
  const spatialQuality = inspectTurkeyAdm3SpatialQuality({
    zones: dataset.zones,
    districts: selectedDistricts.map((entry) => entry.zone)
  });
  const coverage = createTurkeyAdm3BuildCoverageReport({
    generatedAt,
    fallbacks,
    districts: districtReports,
    providers: records,
    sourceModes,
    sourceStatus: {
      official: sourceModes.official
        ? officialArtifactPath
          ? "artifact-loaded"
          : "not-built"
        : "disabled",
      runtime: sourceModes.runtime
        ? runtimeArtifactPath
          ? "artifact-loaded"
          : "not-built"
        : "disabled",
      osm: sourceModes.osm ? (osmArtifactPath ? "artifact-loaded" : "not-built") : "disabled",
      generated: sourceModes.generated ? "built" : "disabled"
    }
  });
  const quality = {
    schemaVersion: "territorykit-tr-adm3-geometry-quality@1",
    country: "TR",
    generatedAt,
    sourceMode: "real-geometry-build",
    ok: validation.ok && spatialQuality.ok && coverage.districtsBelow9999.length === 0,
    summary: {
      geometryErrors: validation.issues.filter((issue) => issue.severity === "error").length,
      validationIssueCount: validation.issues.length,
      overlapCount: spatialQuality.summary.overlapCount,
      gapCount: spatialQuality.summary.gapCount,
      sliverCount: spatialQuality.summary.sliverCount,
      parentContainmentErrors: spatialQuality.summary.parentContainmentErrors,
      duplicateGeometryCount: spatialQuality.summary.duplicateGeometryCount
    },
    issues: validation.issues,
    spatialQuality
  };
  const coverageReport = {
    ...coverage,
    geometryErrors: quality.summary.geometryErrors,
    overlapCount: quality.summary.overlapCount,
    gapCount: quality.summary.gapCount,
    sliverCount: quality.summary.sliverCount,
    parentContainmentErrors: quality.summary.parentContainmentErrors,
    duplicateGeometryCount: quality.summary.duplicateGeometryCount
  };
  const districtCoverage = createTurkeyAdm3DistrictCoverageReport(districtReports, spatialQuality);
  const renderArtifacts = buildTerritoryRenderArtifacts({
    dataset,
    format: "mvt",
    layerId: "territory_adm3",
    policies: [
      {
        adminLevel: "ADM3",
        minZoom: 10,
        maxZoom: 12
      }
    ],
    minZoom: 10,
    maxZoom: 12,
    buildDate: generatedAt
  });
  const queryArtifact = createTurkeyAdm3QueryArtifact(dataset, generatedAt);
  const performanceReport = {
    schemaVersion: "territorykit-tr-adm3-build-performance@1",
    country: "TR",
    generatedAt,
    metrics: {
      totalDurationMs: Math.round(performance.now() - startedAt),
      adjacencyDurationMs: adjacency.statistics.durationMs,
      renderArtifactCount: renderArtifacts.files.size,
      peakRssBytes: process.memoryUsage().rss,
      nationalFeatureCount: dataset.zones.length,
      nationalDatasetBytes: Buffer.byteLength(JSON.stringify(dataset))
    }
  };
  const officialIngestion = createTurkeyAdm3OfficialIngestionStatus(records, coverageReport);
  const osmCoverage = createTurkeyAdm3OsmCoverageStatus(records, coverage);
  const summary = {
    schemaVersion: "territorykit-tr-adm3-build-summary@1",
    country: "TR",
    generatedAt,
    provinceCount: coverage.provinceCount,
    districtCount: coverage.districtCount,
    builtDistrictCount: selectedDistricts.length,
    officialPolygons: coverage.officialPolygons,
    runtimePolygons: coverage.runtimePolygons,
    osmPolygons: coverage.osmPolygons,
    generatedPolygons: coverage.generatedPolygons,
    totalRealPolygons: coverage.totalRealPolygons,
    totalFinalPolygons: finalZones.length,
    realCoveragePercent: coverage.realAdm3CoveragePercent,
    officialCoveragePercent: coverage.officialCoveragePercent,
    runtimeCoveragePercent: coverage.runtimeCoveragePercent,
    osmCoveragePercent: coverage.osmCoveragePercent,
    generatedCoveragePercent: coverage.generatedFallbackCoveragePercent,
    finalCoveragePercent: coverage.finalUsableCoveragePercent,
    artifactRoot,
    datasetPath,
    coverageReport: coverageReportPath,
    qualityReport: qualityReportPath,
    districtCoverageReport: join(artifactRoot, "district-coverage.json"),
    adjacencyReport: join(artifactRoot, "adjacency/adjacency.json"),
    queryArtifact: join(artifactRoot, "query/query-artifact.json"),
    performanceReport: join(artifactRoot, "build-performance.json"),
    sourceModes,
    sourceStatus: coverage.sourceStatus,
    qualityOk: quality.ok,
    validationIssueCount: quality.summary.validationIssueCount,
    overlapCount: quality.summary.overlapCount,
    gapCount: quality.summary.gapCount,
    parentContainmentErrors: quality.summary.parentContainmentErrors,
    coverageTargetMet: coverage.districtsBelow9999.length === 0,
    durationMs: Math.round(performance.now() - startedAt)
  };

  await writeJsonOutput(datasetPath, dataset, force);
  await writeJsonOutput(coverageReportPath, coverageReport, force);
  await writeJsonOutput(qualityReportPath, quality, force);
  await writeJsonOutput(join(artifactRoot, "district-coverage.json"), districtCoverage, force);
  await writeJsonOutput(join(artifactRoot, "adjacency/adjacency.json"), adjacency.artifact, force);
  await writeJsonOutput(
    join(artifactRoot, "adjacency/build-report.json"),
    {
      generatedAt,
      issues: adjacency.issues,
      statistics: adjacency.statistics
    },
    force
  );
  await writeJsonOutput(join(artifactRoot, "query/query-artifact.json"), queryArtifact, force);
  await writeJsonOutput(join(artifactRoot, "build-performance.json"), performanceReport, force);
  await writeJsonOutput(join(artifactRoot, "official-ingestion.json"), officialIngestion, force);
  await writeJsonOutput(join(artifactRoot, "osm-coverage.json"), osmCoverage, force);
  for (const [path, content] of renderArtifacts.files) {
    const renderPath = join(artifactRoot, path);
    await mkdir(dirname(renderPath), { recursive: true });
    await writeFile(renderPath, content);
  }
  await writeTurkeyAdm3ProvinceArtifacts({
    artifactRoot,
    dataset,
    coverageReport,
    quality,
    queryArtifact,
    generatedAt,
    force
  });
  await writeJsonOutput(summaryPath, summary, force);

  printJson({ ok: true, command: "tr adm3 build", data: summary });
  return 0;
}

async function runTurkeyAdm3Generate(args: string[]): Promise<number> {
  const startedAt = performance.now();
  const flags = parseFlags(args);
  const inputPath =
    getFlag(flags, "district") ?? getFlag(flags, "input") ?? getFlag(flags, "dataset");
  const outputRoot = getFlag(flags, "output");
  const districtId = getFlag(flags, "district-id") ?? getFlag(flags, "zone-id");
  const profile = (getFlag(flags, "profile") ?? "auto") as TurkeyGameZoneProfile;
  const seed = getFlag(flags, "seed");
  const fragmentStrategy = getFlag(flags, "fragment-strategy") as
    TurkeyGameZoneFragmentStrategy | undefined;
  const flagIssues: CliIssue[] = [];
  const targetAreaKm2 = readOptionalPositiveNumberFlag(flags, "target-area", flagIssues);
  const targetZoneCount = readOptionalPositiveIntegerFlag(flags, "target-zone-count", flagIssues);
  const minAreaKm2 = readOptionalPositiveNumberFlag(flags, "min-area", flagIssues);
  const maxAreaKm2 = readOptionalPositiveNumberFlag(flags, "max-area", flagIssues);
  const maxZonesPerDistrict = readOptionalPositiveIntegerFlag(flags, "max-zones", flagIssues);
  const minFragmentAreaKm2 = readOptionalPositiveNumberFlag(flags, "min-fragment-area", flagIssues);
  const population = readOptionalNonNegativeNumberFlag(flags, "population", flagIssues);
  const populationDensityPerKm2 = readOptionalNonNegativeNumberFlag(
    flags,
    "population-density",
    flagIssues
  );
  const urbanityHint = readTurkeyAdm3UrbanityHint(flags);

  if (!inputPath || !outputRoot) {
    printJson({
      ok: false,
      command: "tr adm3 generate",
      issues: [
        ...(!inputPath ? [createCliIssue("--district, --input, or --dataset is required.")] : []),
        ...(!outputRoot ? [createCliIssue("--output is required.")] : [])
      ]
    });
    return 2;
  }

  if (flagIssues.length > 0) {
    printJson({ ok: false, command: "tr adm3 generate", issues: flagIssues });
    return 2;
  }

  try {
    const district = await readTurkeyAdm3GenerateDistrict(inputPath, districtId);
    const { provinceCode, districtCode } = resolveTurkeyAdm3GenerateCodes(district, flags);
    const generatorOptions = {
      district,
      provinceCode,
      districtCode,
      profile,
      ...(seed ? { seed } : {}),
      ...(targetAreaKm2 ? { targetAreaKm2 } : {}),
      ...(targetZoneCount ? { targetZoneCount } : {}),
      ...(minAreaKm2 ? { minAreaKm2 } : {}),
      ...(maxAreaKm2 ? { maxAreaKm2 } : {}),
      ...(maxZonesPerDistrict ? { maxZonesPerDistrict } : {}),
      ...(minFragmentAreaKm2 ? { minFragmentAreaKm2 } : {}),
      ...(population !== undefined ? { population } : {}),
      ...(populationDensityPerKm2 !== undefined ? { populationDensityPerKm2 } : {}),
      ...(urbanityHint ? { urbanityHint } : {}),
      ...(fragmentStrategy ? { fragmentStrategy } : {})
    } satisfies TurkeyGameZoneGeneratorOptions;
    const validation = validateTurkeyGameZoneGeneratorOptions(generatorOptions);

    if (!validation.ok) {
      printJson({
        ok: false,
        command: "tr adm3 generate",
        issues: validation.issues
      });
      return 2;
    }

    if (flags.has("dry-run") || flags.has("plan")) {
      printJson({
        ok: true,
        command: "tr adm3 generate",
        data: {
          dryRun: true,
          districtId: district.id,
          provinceCode,
          districtCode,
          configuration: validation.configuration,
          issues: validation.issues
        }
      });
      return 0;
    }

    const result = await buildTurkeyGameZonesWithAdjacency(generatorOptions);
    const dataset = createTurkeyGameZoneDataset({
      district,
      zones: result.zones,
      datasetId: "tr-adm3-game-zone-build",
      sourceDate: result.configuration.algorithmVersion
    });
    const trV2Validation = validateTurkeyV2Dataset(dataset);
    const artifactPaths = {
      dataset: join(outputRoot, "dataset.json"),
      fullGeoJson: join(outputRoot, "full.geojson"),
      coverage: join(outputRoot, "coverage.json"),
      quality: join(outputRoot, "quality-report.json"),
      adjacency: join(outputRoot, "adjacency.json"),
      buildSummary: join(outputRoot, "build-summary.json"),
      configuration: join(outputRoot, "configuration.json"),
      checksums: join(outputRoot, "checksums.json")
    };
    const fullGeoJson = territoryDatasetToFeatureCollection(dataset);
    const summary = {
      schemaVersion: "territorykit-tr-adm3-game-zone-build-summary@1",
      command: "tr adm3 generate",
      districtId: district.id,
      provinceCode,
      districtCode,
      selectedProfile: result.selectedProfile,
      algorithmVersion: result.configuration.algorithmVersion,
      producedZoneCount: result.zones.length,
      finalCoveragePercent: result.coverage.finalCoveragePercent,
      overlapCount: result.quality.overlapCount,
      parentContainmentErrorCount: result.quality.parentContainmentErrorCount,
      invalidGeometryCount: result.quality.invalidGeometryCount,
      deterministicHash: result.deterministicHash,
      qualityOk: result.quality.ok,
      trV2ValidationOk: trV2Validation.ok,
      durationMs: Math.round(performance.now() - startedAt),
      artifacts: artifactPaths
    };
    const filePayloads = new Map<string, unknown>([
      [artifactPaths.dataset, dataset],
      [artifactPaths.fullGeoJson, fullGeoJson],
      [artifactPaths.coverage, result.coverage],
      [artifactPaths.quality, result.quality],
      [artifactPaths.adjacency, result.adjacency ?? { edges: [] }],
      [artifactPaths.buildSummary, summary],
      [artifactPaths.configuration, result.configuration]
    ]);
    const checksums = createArtifactChecksums(filePayloads);

    for (const [path, payload] of filePayloads) {
      await writeJsonOutput(path, payload, flags.has("force"));
    }
    await writeJsonOutput(artifactPaths.checksums, checksums, flags.has("force"));

    const ok =
      result.quality.ok &&
      result.issues.every((issue) => issue.severity !== "error") &&
      trV2Validation.ok;

    printJson({
      ok,
      command: "tr adm3 generate",
      data: summary,
      issues: [
        ...result.issues,
        ...trV2Validation.issues.map((issue) => ({
          code: issue.code,
          severity: issue.severity,
          message: issue.message,
          zoneId: issue.zoneId,
          parentId: issue.parentId
        }))
      ]
    });
    return ok ? 0 : 1;
  } catch (error) {
    printJson({
      ok: false,
      command: "tr adm3 generate",
      issues: [createCliIssue(error instanceof Error ? error.message : String(error))]
    });
    return 2;
  }
}

async function readTurkeyAdm3GenerateDistrict(
  inputPath: string,
  districtId: string | undefined
): Promise<TerritoryZone> {
  const input = await readJson(inputPath);

  if (isTerritoryZoneLike(input)) {
    return input;
  }

  const zones =
    isRecordValue(input) && Array.isArray(input.zones)
      ? input.zones
          .filter(isTerritoryZoneLike)
          .filter((zone) => zone.level === 2 || zone.sourceAdminLevel === "ADM2")
      : loadTerritoryDataset(input).zones.filter(
          (zone) => zone.level === 2 || zone.sourceAdminLevel === "ADM2"
        );
  const selected = districtId ? zones.find((zone) => zone.id === districtId) : zones[0];

  if (!selected) {
    throw new Error(
      districtId
        ? `District zone '${districtId}' was not found in ${inputPath}.`
        : `No ADM2 district zone was found in ${inputPath}.`
    );
  }

  return selected;
}

function resolveTurkeyAdm3GenerateCodes(
  district: TerritoryZone,
  flags: Map<string, string | true>
): { provinceCode: string; districtCode: string } {
  const territory = isRecordValue(district.properties.territory)
    ? district.properties.territory
    : {};
  const provinceCode =
    getFlag(flags, "province-code") ??
    readTurkeyAdm3StringProperty(territory, "provinceCode") ??
    readTurkeyAdm3StringProperty(territory, "adm2.provinceCode") ??
    "00";
  const districtCode =
    getFlag(flags, "district-code") ??
    readTurkeyAdm3StringProperty(territory, "districtCode") ??
    readTurkeyAdm3StringProperty(territory, "adm2.districtCode") ??
    district.id.replace(/^tr:adm2:/, "").slice(0, 12);

  return { provinceCode, districtCode };
}

function readTurkeyAdm3UrbanityHint(
  flags: Map<string, string | true>
): "urban" | "suburban" | "rural" | undefined {
  const value = getFlag(flags, "urbanity-hint");

  if (value === "urban" || value === "suburban" || value === "rural") {
    return value;
  }

  return undefined;
}

function territoryDatasetToFeatureCollection(dataset: TerritoryDataset): Record<string, unknown> {
  return {
    type: "FeatureCollection",
    territoryKit: {
      datasetId: dataset.manifest.datasetId,
      datasetVersion: dataset.manifest.datasetVersion,
      geometryHash: dataset.manifest.geometryHash
    },
    features: dataset.zones.map((zone) => ({
      type: "Feature",
      id: zone.id,
      properties: {
        ...zone.properties,
        id: zone.id,
        datasetId: zone.datasetId,
        countryCode: zone.countryCode,
        level: zone.level,
        sourceAdminLevel: zone.sourceAdminLevel,
        semanticType: zone.semanticType,
        name: zone.name,
        localName: zone.localName,
        parentId: zone.parentId,
        childIds: zone.childIds,
        neighborIds: zone.neighborIds,
        bbox: zone.bbox,
        center: zone.center
      },
      geometry: zone.geometry
    }))
  };
}

function createArtifactChecksums(
  filePayloads: ReadonlyMap<string, unknown>
): Record<string, unknown> {
  const files = Object.fromEntries(
    [...filePayloads.entries()]
      .map(([path, payload]) => {
        const serialized = `${JSON.stringify(payload, null, 2)}\n`;
        return [
          path.split("/").pop() ?? path,
          {
            sha256: sha256Text(serialized),
            byteSize: Buffer.byteLength(serialized)
          }
        ] as const;
      })
      .sort(([left], [right]) => left.localeCompare(right))
  );

  return {
    schemaVersion: "territorykit-tr-adm3-game-zone-checksums@1",
    files
  };
}

async function readTurkeyAdm3ProviderRecords(
  flags: Map<string, string | true>
): Promise<TurkeyAdm3ProviderRecord[]> {
  const registryPath =
    getFlag(flags, "registry") ?? cliWorkspacePath("datasets/registry/tr-adm3-providers.json");
  const input = await readJson(registryPath);

  if (!isRecordValue(input) || !Array.isArray(input.records)) {
    throw new Error(`Bad ADM3 provider registry ${registryPath}`);
  }

  return input.records as TurkeyAdm3ProviderRecord[];
}

async function readTurkeyAdm3FallbackRegistry(
  flags: Map<string, string | true>
): Promise<TurkeyAdm3FallbackRegistry> {
  const fallbackPath =
    getFlag(flags, "fallbacks") ??
    cliWorkspacePath("datasets/registry/tr-adm3-district-fallbacks.json");
  const input = await readJson(fallbackPath);

  if (!isRecordValue(input) || !Array.isArray(input.districts)) {
    throw new Error(`Bad ADM3 fallback registry ${fallbackPath}`);
  }

  return input as unknown as TurkeyAdm3FallbackRegistry;
}

type TurkeyAdm3BuildSourceModes = {
  official: boolean;
  runtime: boolean;
  experimental: boolean;
  osm: boolean;
  generated: boolean;
};

type TurkeyAdm3BuildSourceStatus = {
  official: "artifact-loaded" | "disabled" | "not-built";
  runtime: "artifact-loaded" | "disabled" | "not-built";
  osm: "artifact-loaded" | "disabled" | "not-built";
  generated: "built" | "disabled";
};

type TurkeyAdm3BuildDistrictCoverage = ReturnType<typeof computeTurkeyAdm3DistrictCoverage> & {
  districtName: string;
  provinceName: string;
};

async function readTurkeyAdm3Adm2Zones(datasetPath: string): Promise<TerritoryZone[]> {
  const input = await readJson(datasetPath);

  if (!isRecordValue(input) || !Array.isArray(input.zones)) {
    throw new Error(`Bad Turkey ADM2 dataset ${datasetPath}`);
  }

  return input.zones
    .filter(isTerritoryZoneLike)
    .filter((zone) => zone.level === 2 || zone.sourceAdminLevel === "ADM2")
    .sort((left, right) => left.id.localeCompare(right.id));
}

async function readTurkeyAdm3Adm3Zones(datasetPath: string | undefined): Promise<TerritoryZone[]> {
  if (!datasetPath) {
    return [];
  }

  const input = await readJson(datasetPath);

  if (!isRecordValue(input) || !Array.isArray(input.zones)) {
    throw new Error(`Bad Turkey ADM3 artifact ${datasetPath}`);
  }

  return input.zones
    .filter(isTerritoryZoneLike)
    .map((zone) => {
      const territory = isRecordValue(zone.properties.territory) ? zone.properties.territory : {};
      const parentId =
        typeof zone.parentId === "string"
          ? zone.parentId
          : (readTurkeyAdm3StringProperty(territory, "sourceParentId") ??
            readTurkeyAdm3StringProperty(territory, "parentAdm2Id"));

      return parentId ? { ...zone, parentId } : zone;
    })
    .filter(
      (zone) =>
        (zone.level === 3 || zone.sourceAdminLevel === "ADM3") && typeof zone.parentId === "string"
    )
    .sort((left, right) => left.id.localeCompare(right.id));
}

function groupTurkeyAdm3ZonesByParent(
  zones: readonly TerritoryZone[]
): Map<string, TerritoryZone[]> {
  const grouped = new Map<string, TerritoryZone[]>();

  for (const zone of zones) {
    if (!zone.parentId) {
      continue;
    }

    const siblings = grouped.get(zone.parentId) ?? [];
    siblings.push(zone);
    grouped.set(zone.parentId, siblings);
  }

  for (const [parentId, siblings] of grouped.entries()) {
    grouped.set(
      parentId,
      siblings.sort((left, right) => left.id.localeCompare(right.id))
    );
  }

  return grouped;
}

function normalizeTurkeyAdm3BuildZone(zone: TerritoryZone, datasetId: string): TerritoryZone {
  const territory = isRecordValue(zone.properties.territory) ? zone.properties.territory : {};

  return {
    ...zone,
    datasetId,
    properties: {
      ...zone.properties,
      territory: {
        ...territory,
        semanticType:
          typeof territory.semanticType === "string" && territory.semanticType !== "generated-zone"
            ? territory.semanticType
            : zone.semanticType,
        localType: typeof territory.localType === "string" ? territory.localType : "generated-zone",
        sourceDatasetId: zone.datasetId
      }
    }
  };
}

function addTurkeyAdm3NeighborsFromAdjacency(
  zones: readonly TerritoryZone[],
  edges: ReadonlyArray<{ from: string; to: string }>
): TerritoryZone[] {
  const neighbors = new Map<string, Set<string>>();

  for (const zone of zones) {
    neighbors.set(zone.id, new Set());
  }

  for (const edge of edges) {
    neighbors.get(edge.from)?.add(edge.to);
    neighbors.get(edge.to)?.add(edge.from);
  }

  return zones
    .map((zone) => ({
      ...zone,
      neighborIds: [...(neighbors.get(zone.id) ?? new Set<string>())].sort()
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function createTurkeyAdm3QueryArtifact(
  dataset: TerritoryDataset,
  generatedAt: string
): Record<string, unknown> {
  const byId = Object.fromEntries(
    dataset.zones.map((zone) => [
      zone.id,
      {
        id: zone.id,
        name: zone.name,
        parentId: zone.parentId,
        bbox: zone.bbox,
        center: zone.center,
        neighborIds: zone.neighborIds
      }
    ])
  );
  const childrenByParent = new Map<string, string[]>();

  for (const zone of dataset.zones) {
    if (!zone.parentId) {
      continue;
    }

    const children = childrenByParent.get(zone.parentId) ?? [];
    children.push(zone.id);
    childrenByParent.set(zone.parentId, children);
  }

  return {
    schemaVersion: "territorykit-tr-adm3-query-artifact@1",
    generatedAt,
    zoneCount: dataset.zones.length,
    byId,
    childrenByParent: Object.fromEntries(
      [...childrenByParent.entries()]
        .map(([parentId, ids]) => [parentId, ids.sort()] as const)
        .sort(([left], [right]) => left.localeCompare(right))
    ),
    bbox: dataset.zones
      .map((zone) => ({ id: zone.id, bbox: zone.bbox }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    neighbors: Object.fromEntries(
      dataset.zones
        .map((zone) => [zone.id, zone.neighborIds] as const)
        .sort(([left], [right]) => left.localeCompare(right))
    )
  };
}

function createTurkeyAdm3DistrictCoverageReport(
  districts: readonly TurkeyAdm3BuildDistrictCoverage[],
  spatialQuality: ReturnType<typeof inspectTurkeyAdm3SpatialQuality>
): Array<Record<string, unknown>> {
  const gaps = new Map(spatialQuality.gaps.map((gap) => [gap.districtId, gap.areaKm2]));
  const slivers = new Map<string, number>();
  const overlaps = new Map<string, number>();

  for (const sliver of spatialQuality.slivers) {
    if (sliver.parentId) {
      slivers.set(sliver.parentId, (slivers.get(sliver.parentId) ?? 0) + 1);
    }
  }

  for (const overlap of spatialQuality.overlaps) {
    if (overlap.parentId) {
      overlaps.set(overlap.parentId, (overlaps.get(overlap.parentId) ?? 0) + overlap.areaKm2);
    }
  }

  return districts
    .map((district) => ({
      districtId: district.districtId,
      districtName: district.districtName,
      provinceCode: district.provinceCode,
      provinceName: district.provinceName,
      officialCount: district.officialPolygonCount,
      osmCount: district.osmPolygonCount,
      generatedCount: district.generatedPolygonCount,
      realCoveragePercent: district.realCoveragePercent,
      generatedCoveragePercent: district.generatedCoveragePercent,
      finalCoveragePercent: district.finalCoveragePercent,
      gapAreaKm2: gaps.get(district.districtId) ?? 0,
      overlapAreaKm2: Number((overlaps.get(district.districtId) ?? 0).toFixed(6)),
      sliverCount: slivers.get(district.districtId) ?? 0
    }))
    .sort((left, right) => String(left.districtId).localeCompare(String(right.districtId)));
}

function createTurkeyAdm3OfficialIngestionStatus(
  providers: readonly TurkeyAdm3ProviderRecord[],
  coverage: Record<string, unknown>
): Record<string, unknown> {
  const officialPolygons = Number(coverage.officialPolygons ?? 0);
  const qualityPassed =
    officialPolygons > 0 &&
    Number(coverage.geometryErrors ?? 0) === 0 &&
    Number(coverage.overlapCount ?? 0) === 0 &&
    Number(coverage.sliverCount ?? 0) === 0 &&
    Number(coverage.parentContainmentErrors ?? 0) === 0 &&
    Number(coverage.duplicateGeometryCount ?? 0) === 0 &&
    (Array.isArray(coverage.districtsBelow9999) ? coverage.districtsBelow9999.length === 0 : true);

  return {
    schemaVersion: "territorykit-tr-adm3-official-ingestion@1",
    country: "TR",
    generatedAt: coverage.generatedAt,
    providers: providers
      .filter((provider) => provider.providerClass === "official")
      .map((provider) => ({
        providerId: provider.id,
        provinceCode: provider.provinceCode,
        verified: provider.status === "verified",
        downloaded: false,
        checksumVerified: Boolean(provider.expectedSha256),
        parsed: officialPolygons > 0,
        parentResolved: officialPolygons > 0,
        qualityPassed,
        artifactBuilt: officialPolygons > 0,
        expectedFeatureCount: provider.expectedFeatureCount ?? null,
        buildStatus:
          officialPolygons > 0
            ? qualityPassed
              ? "built-from-artifact"
              : "built-from-artifact-quality-blocked"
            : "not-built"
      }))
      .sort((left, right) => left.providerId.localeCompare(right.providerId))
  };
}

function createTurkeyAdm3OsmCoverageStatus(
  providers: readonly TurkeyAdm3ProviderRecord[],
  coverage: Record<string, unknown>
): Record<string, unknown> {
  return {
    schemaVersion: "territorykit-tr-adm3-osm-coverage@1",
    country: "TR",
    generatedAt: coverage.generatedAt,
    providerCount: providers.filter((provider) => provider.providerClass === "osm").length,
    polygonCount: coverage.osmPolygons ?? 0,
    areaKm2: coverage.osmAreaKm2 ?? 0,
    coveragePercent: coverage.osmCoveragePercent ?? 0,
    sourceStatus: (coverage.sourceStatus as Record<string, unknown> | undefined)?.osm ?? "unknown",
    license: "ODbL-1.0",
    attribution: "OpenStreetMap contributors, ODbL 1.0"
  };
}

async function writeTurkeyAdm3ProvinceArtifacts(input: {
  artifactRoot: string;
  dataset: TerritoryDataset;
  coverageReport: Record<string, unknown>;
  quality: Record<string, unknown>;
  queryArtifact: Record<string, unknown>;
  generatedAt: string;
  force: boolean;
}): Promise<void> {
  const provinces = Array.isArray(input.coverageReport.provinces)
    ? (input.coverageReport.provinces as Array<Record<string, unknown>>)
    : [];
  const manifestEntries: Array<Record<string, unknown>> = [];

  for (const province of provinces) {
    const provinceCode = String(province.provinceCode);
    const zones = input.dataset.zones.filter(
      (zone) => provinceCodeForTurkeyAdm3Zone(zone) === provinceCode
    );
    const provinceDataset: TerritoryDataset = {
      manifest: {
        ...input.dataset.manifest,
        datasetId: `${input.dataset.manifest.datasetId}-${provinceCode}`,
        name: `Turkey ADM3-like province build ${provinceCode}`,
        geometryHash: createDatasetGeometryHash({ zones })
      },
      zones
    };
    const provinceRoot = join(input.artifactRoot, "provinces", provinceCode);
    const datasetJson = JSON.stringify(provinceDataset, null, 2);
    const checksum = sha256Text(datasetJson);

    await writeJsonOutput(join(provinceRoot, "dataset.json"), provinceDataset, input.force);
    await writeJsonOutput(join(provinceRoot, "coverage.json"), province, input.force);
    await writeJsonOutput(join(provinceRoot, "quality.json"), input.quality, input.force);
    await writeJsonOutput(
      join(provinceRoot, "query/query-artifact.json"),
      filterTurkeyAdm3QueryArtifactForZones(input.queryArtifact, zones),
      input.force
    );
    await writeJsonOutput(
      join(provinceRoot, "sources.json"),
      {
        provinceCode,
        sourceClasses: countTurkeyAdm3SourceClasses(zones)
      },
      input.force
    );

    manifestEntries.push({
      provinceCode,
      provinceName: province.provinceName,
      version: input.generatedAt,
      checksum,
      byteSize: Buffer.byteLength(datasetJson),
      featureCount: zones.length,
      officialCount: province.officialPolygonCount ?? 0,
      osmCount: province.osmPolygonCount ?? 0,
      generatedCount: province.generatedPolygonCount ?? 0,
      realCoveragePercent: province.realCoveragePercent ?? null,
      generatedCoveragePercent: province.generatedCoveragePercent ?? null,
      finalCoveragePercent: province.finalCoveragePercent ?? null
    });
  }

  await writeJsonOutput(
    join(input.artifactRoot, "national/manifest.json"),
    {
      schemaVersion: "territorykit-tr-adm3-national-manifest@1",
      country: "TR",
      generatedAt: input.generatedAt,
      licenses: [
        "Municipal open-data licenses",
        "CC BY 4.0",
        "ODbL 1.0",
        "TerritoryKit generated / Apache-2.0"
      ],
      provinces: manifestEntries.sort((left, right) =>
        String(left.provinceCode).localeCompare(String(right.provinceCode))
      )
    },
    input.force
  );
}

function filterTurkeyAdm3QueryArtifactForZones(
  queryArtifact: Record<string, unknown>,
  zones: readonly TerritoryZone[]
): Record<string, unknown> {
  const ids = new Set(zones.map((zone) => zone.id));

  return {
    ...queryArtifact,
    zoneCount: zones.length,
    byId: Object.fromEntries(
      Object.entries((queryArtifact.byId as Record<string, unknown>) ?? {}).filter(([id]) =>
        ids.has(id)
      )
    ),
    bbox: ((queryArtifact.bbox as Array<{ id: string }> | undefined) ?? []).filter((entry) =>
      ids.has(entry.id)
    ),
    childrenByParent: Object.fromEntries(
      Object.entries((queryArtifact.childrenByParent as Record<string, string[]> | undefined) ?? {})
        .map(
          ([parentId, childIds]) =>
            [parentId, childIds.filter((childId) => ids.has(childId)).sort()] as const
        )
        .filter(([, childIds]) => childIds.length > 0)
        .sort(([left], [right]) => left.localeCompare(right))
    ),
    neighbors: Object.fromEntries(
      zones.map((zone) => [zone.id, zone.neighborIds.filter((id) => ids.has(id))])
    )
  };
}

function provinceCodeForTurkeyAdm3Zone(zone: TerritoryZone): string | undefined {
  const territory = isRecordValue(zone.properties.territory) ? zone.properties.territory : {};
  const explicit = territory.provinceCode;

  if (typeof explicit === "string" && /^\d{2}$/.test(explicit)) {
    return explicit;
  }

  const adm3Metadata = isRecordValue(territory.adm3) ? territory.adm3 : {};
  const nestedExplicit = adm3Metadata.provinceCode;

  if (typeof nestedExplicit === "string" && /^\d{2}$/.test(nestedExplicit)) {
    return nestedExplicit;
  }

  const idMatch =
    zone.id.match(/tr-il-(\d{2})(?:-|:|$)/) ?? zone.id.match(/(?:^|[:-])tr-(\d{2})(?:-|$)/);

  if (idMatch?.[1]) {
    return idMatch[1];
  }

  return undefined;
}

function readTurkeyAdm3StringProperty(
  input: Record<string, unknown>,
  path: string
): string | undefined {
  let current: unknown = input;

  for (const segment of path.split(".")) {
    if (!isRecordValue(current)) {
      return undefined;
    }

    current = current[segment];
  }

  return typeof current === "string" && current.length > 0 ? current : undefined;
}

function countTurkeyAdm3SourceClasses(zones: readonly TerritoryZone[]): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const zone of zones) {
    const territory = isRecordValue(zone.properties.territory) ? zone.properties.territory : {};
    const sourceClass =
      typeof territory.sourceClass === "string" ? territory.sourceClass : "unknown";
    counts[sourceClass] = (counts[sourceClass] ?? 0) + 1;
  }

  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) => left.localeCompare(right))
  );
}

function sha256Text(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

async function createTurkeyAdm3ProviderNetworkHealthReport(input: {
  providers: readonly TurkeyAdm3ProviderRecord[];
  checkedAt: string;
}): Promise<Array<Record<string, unknown>>> {
  const checkable = input.providers
    .filter(
      (provider) =>
        provider.providerClass === "runtime" || provider.providerClass === "experimental"
    )
    .sort((left, right) => left.id.localeCompare(right.id));
  const health = [];

  for (const provider of checkable) {
    const url = provider.serviceUrl ?? provider.downloadUrl ?? provider.sourceUrl;
    const startedAt = performance.now();

    if (!url || !isSafeTurkeyAdm3HealthUrl(url)) {
      health.push({
        providerId: provider.id,
        reachable: false,
        lastCheckedAt: input.checkedAt,
        errorCode: "TR_ADM3_HEALTH_URL_UNSAFE_OR_MISSING",
        fallbackProviderId: `tr-adm3-osm-${provider.provinceCode}`
      });
      continue;
    }

    try {
      const response = await fetch(url, {
        method: provider.format.includes("arcgis") ? "GET" : "HEAD",
        redirect: "manual",
        signal: AbortSignal.timeout(8_000)
      });

      health.push({
        providerId: provider.id,
        reachable: response.ok,
        httpStatus: response.status,
        latencyMs: Math.round(performance.now() - startedAt),
        lastCheckedAt: input.checkedAt,
        serviceMetadataValid: response.ok,
        ...(response.ok ? {} : { errorCode: `TR_ADM3_HTTP_${response.status}` }),
        fallbackProviderId: `tr-adm3-osm-${provider.provinceCode}`
      });
    } catch (error) {
      health.push({
        providerId: provider.id,
        reachable: false,
        latencyMs: Math.round(performance.now() - startedAt),
        lastCheckedAt: input.checkedAt,
        errorCode:
          error instanceof Error && error.name === "TimeoutError"
            ? "TR_ADM3_HEALTH_TIMEOUT"
            : "TR_ADM3_HEALTH_REQUEST_FAILED",
        fallbackProviderId: `tr-adm3-osm-${provider.provinceCode}`
      });
    }
  }

  return health;
}

function isSafeTurkeyAdm3HealthUrl(input: string): boolean {
  let parsed: URL;

  try {
    parsed = new URL(input);
  } catch {
    return false;
  }

  if (!["https:", "http:"].includes(parsed.protocol)) {
    return false;
  }

  const hostname = parsed.hostname.toLowerCase();

  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "::1" ||
    hostname.startsWith("127.") ||
    hostname.startsWith("10.") ||
    hostname.startsWith("192.168.") ||
    hostname.startsWith("169.254.")
  ) {
    return false;
  }

  const private172 = hostname.match(/^172\.(\d{1,2})\./);

  if (private172) {
    const octet = Number(private172[1]);
    return octet < 16 || octet > 31;
  }

  return true;
}

function createTurkeyAdm3BuildCoverageReport(input: {
  generatedAt: string;
  fallbacks: TurkeyAdm3FallbackRegistry;
  providers: readonly TurkeyAdm3ProviderRecord[];
  districts: readonly TurkeyAdm3BuildDistrictCoverage[];
  sourceModes: TurkeyAdm3BuildSourceModes;
  sourceStatus: TurkeyAdm3BuildSourceStatus;
}): Record<string, unknown> & {
  districtCount: number;
  provinceCount: number;
  officialPolygons: number;
  runtimePolygons: number;
  osmPolygons: number;
  generatedPolygons: number;
  totalRealPolygons: number;
  realAdm3CoveragePercent: number;
  officialCoveragePercent: number;
  runtimeCoveragePercent: number;
  osmCoveragePercent: number;
  generatedFallbackCoveragePercent: number;
  finalUsableCoveragePercent: number;
  districtsBelow9999: Array<{
    districtId: string;
    districtName: string;
    provinceCode?: string;
    provinceName: string;
    finalCoveragePercent: number;
    missingBeforeGeneratedAreaKm2: number;
  }>;
  sourceStatus: TurkeyAdm3BuildSourceStatus;
} {
  const totalDistrictAreaKm2 = sumCoverage(input.districts, "districtAreaKm2");
  const officialAreaKm2 = sumCoverage(input.districts, "officialAreaKm2");
  const runtimeAreaKm2 = sumCoverage(input.districts, "runtimeAreaKm2");
  const osmAreaKm2 = sumCoverage(input.districts, "osmAreaKm2");
  const generatedAreaKm2 = sumCoverage(input.districts, "generatedAreaKm2");
  const realCoverageAreaKm2 = sumCoverage(input.districts, "realCoverageAreaKm2");
  const finalCoverageAreaKm2 = sumCoverage(input.districts, "finalCoverageAreaKm2");
  const officialPolygons = sumCoverage(input.districts, "officialPolygonCount");
  const runtimePolygons = sumCoverage(input.districts, "runtimePolygonCount");
  const osmPolygons = sumCoverage(input.districts, "osmPolygonCount");
  const generatedPolygons = sumCoverage(input.districts, "generatedPolygonCount");
  const districtsBelow9999 = input.districts
    .filter((district) => district.finalCoveragePercent < 99.99)
    .map((district) => ({
      districtId: district.districtId,
      districtName: district.districtName,
      ...(district.provinceCode ? { provinceCode: district.provinceCode } : {}),
      provinceName: district.provinceName,
      finalCoveragePercent: district.finalCoveragePercent,
      missingBeforeGeneratedAreaKm2: district.missingBeforeGeneratedAreaKm2
    }));
  const provinces = aggregateTurkeyAdm3ProvinceCoverage(input.districts);

  return {
    schemaVersion: "territorykit-tr-adm3-national-coverage@2",
    country: "TR",
    generatedAt: input.generatedAt,
    provinceCount: new Set(input.districts.map((district) => district.provinceCode)).size,
    districtCount: input.districts.length,
    registryDistrictCount: input.fallbacks.districtCount,
    providerRecords: input.providers.length,
    officialProviderProvinces: uniqueProviderProvinceCount(input.providers, "official"),
    runtimeProviderProvinces: uniqueProviderProvinceCount(input.providers, "runtime"),
    experimentalProviderProvinces: uniqueProviderProvinceCount(input.providers, "experimental"),
    osmProviderProvinces: uniqueProviderProvinceCount(input.providers, "osm"),
    generatedProviderProvinces: uniqueProviderProvinceCount(input.providers, "generated"),
    sourceModes: input.sourceModes,
    sourceStatus: input.sourceStatus,
    officialPolygons,
    runtimePolygons,
    osmPolygons,
    generatedPolygons,
    totalRealPolygons: officialPolygons + runtimePolygons + osmPolygons,
    totalGeneratedPolygons: generatedPolygons,
    totalFinalPolygons: officialPolygons + runtimePolygons + osmPolygons + generatedPolygons,
    officialAreaKm2,
    runtimeAreaKm2,
    osmAreaKm2,
    generatedAreaKm2,
    realCoverageAreaKm2,
    finalCoverageAreaKm2,
    officialCoveragePercent: cliPercentage(officialAreaKm2, totalDistrictAreaKm2),
    runtimeCoveragePercent: cliPercentage(runtimeAreaKm2, totalDistrictAreaKm2),
    osmCoveragePercent: cliPercentage(osmAreaKm2, totalDistrictAreaKm2),
    realAdm3CoveragePercent: cliPercentage(realCoverageAreaKm2, totalDistrictAreaKm2),
    generatedFallbackCoveragePercent: cliPercentage(generatedAreaKm2, totalDistrictAreaKm2),
    finalUsableCoveragePercent: cliPercentage(finalCoverageAreaKm2, totalDistrictAreaKm2),
    coveredDistrictsAtOrAbove9999: input.districts.length - districtsBelow9999.length,
    districtsBelow9999,
    provinces,
    notes: [
      "Coverage is measured from built geometry, not provider availability.",
      "Sources marked not-built were not counted as spatial coverage."
    ]
  };
}

function aggregateTurkeyAdm3ProvinceCoverage(
  districts: readonly TurkeyAdm3BuildDistrictCoverage[]
): Array<Record<string, unknown>> {
  const grouped = new Map<
    string,
    {
      provinceCode: string;
      provinceName: string;
      districtAreaKm2: number;
      officialAreaKm2: number;
      runtimeAreaKm2: number;
      osmAreaKm2: number;
      generatedAreaKm2: number;
      realCoverageAreaKm2: number;
      finalCoverageAreaKm2: number;
      officialPolygonCount: number;
      runtimePolygonCount: number;
      osmPolygonCount: number;
      generatedPolygonCount: number;
    }
  >();

  for (const district of districts) {
    const provinceCode = district.provinceCode ?? "unknown";
    const current = grouped.get(provinceCode) ?? {
      provinceCode,
      provinceName: district.provinceName,
      districtAreaKm2: 0,
      officialAreaKm2: 0,
      runtimeAreaKm2: 0,
      osmAreaKm2: 0,
      generatedAreaKm2: 0,
      realCoverageAreaKm2: 0,
      finalCoverageAreaKm2: 0,
      officialPolygonCount: 0,
      runtimePolygonCount: 0,
      osmPolygonCount: 0,
      generatedPolygonCount: 0
    };

    current.districtAreaKm2 += district.districtAreaKm2;
    current.officialAreaKm2 += district.officialAreaKm2;
    current.runtimeAreaKm2 += district.runtimeAreaKm2;
    current.osmAreaKm2 += district.osmAreaKm2;
    current.generatedAreaKm2 += district.generatedAreaKm2;
    current.realCoverageAreaKm2 += district.realCoverageAreaKm2;
    current.finalCoverageAreaKm2 += district.finalCoverageAreaKm2;
    current.officialPolygonCount += district.officialPolygonCount;
    current.runtimePolygonCount += district.runtimePolygonCount;
    current.osmPolygonCount += district.osmPolygonCount;
    current.generatedPolygonCount += district.generatedPolygonCount;
    grouped.set(provinceCode, current);
  }

  return [...grouped.values()]
    .map((province) => ({
      provinceCode: province.provinceCode,
      provinceName: province.provinceName,
      officialPolygonCount: province.officialPolygonCount,
      runtimePolygonCount: province.runtimePolygonCount,
      osmPolygonCount: province.osmPolygonCount,
      generatedPolygonCount: province.generatedPolygonCount,
      realCoveragePercent: cliPercentage(province.realCoverageAreaKm2, province.districtAreaKm2),
      generatedCoveragePercent: cliPercentage(province.generatedAreaKm2, province.districtAreaKm2),
      finalCoveragePercent: cliPercentage(province.finalCoverageAreaKm2, province.districtAreaKm2),
      primarySource:
        province.officialPolygonCount > 0
          ? "official"
          : province.runtimePolygonCount > 0
            ? "runtime"
            : province.osmPolygonCount > 0
              ? "osm"
              : province.generatedPolygonCount > 0
                ? "generated"
                : "none"
    }))
    .sort((left, right) => String(left.provinceCode).localeCompare(String(right.provinceCode)));
}

function sumCoverage<K extends keyof TurkeyAdm3BuildDistrictCoverage>(
  districts: readonly TurkeyAdm3BuildDistrictCoverage[],
  key: K
): number {
  return Number(
    districts
      .reduce((total, district) => {
        const value = district[key];
        return total + (typeof value === "number" ? value : 0);
      }, 0)
      .toFixed(6)
  );
}

function uniqueProviderProvinceCount(
  providers: readonly TurkeyAdm3ProviderRecord[],
  providerClass: TurkeyAdm3ProviderRecord["providerClass"]
): number {
  return new Set(
    providers
      .filter((provider) => provider.providerClass === providerClass)
      .map((provider) => provider.provinceCode)
  ).size;
}

function cliPercentage(value: number, total: number): number {
  return total <= 0 ? 0 : Number(Math.min(100, (value / total) * 100).toFixed(6));
}

function isTerritoryZoneLike(input: unknown): input is TerritoryZone {
  return (
    isRecordValue(input) &&
    typeof input.id === "string" &&
    typeof input.datasetId === "string" &&
    typeof input.level === "number" &&
    Array.isArray(input.neighborIds) &&
    isRecordValue(input.geometry) &&
    Array.isArray(input.bbox) &&
    Array.isArray(input.center) &&
    isRecordValue(input.properties)
  );
}

function runCountryList(args: string[]): number {
  const flags = parseFlags(args);
  const countries = listTerritoryCountryConfigs();

  if (flags.has("json")) {
    printJson({
      ok: true,
      command: "country list",
      data: countries.map((config) => ({
        country: config.countryCodeAlpha2,
        alpha3: config.countryCodeAlpha3,
        name: config.displayName,
        datasetId: config.datasetId,
        packageName: config.loaderPackageName,
        levels: config.requestedLevels,
        sourceProvider: config.sourceProvider
      }))
    });
    return 0;
  }

  console.log(
    countries
      .map((config) =>
        [
          config.countryCodeAlpha2.padEnd(4),
          config.countryCodeAlpha3.padEnd(5),
          config.requestedLevels.join(",").padEnd(16),
          config.loaderPackageName
        ].join("  ")
      )
      .join("\n")
  );
  return 0;
}

function runCountryInfo(args: string[]): number {
  const [country] = args;
  const flags = parseFlags(args.slice(1));

  if (!country || country === "--help" || country === "-h") {
    printCountryInfoHelp();
    return country ? 0 : 2;
  }

  try {
    const config = getTerritoryCountryConfig(country);

    if (flags.has("json")) {
      printJson({ ok: true, command: "country info", data: config });
    } else {
      console.log(formatCountryConfig(config));
    }

    return 0;
  } catch (error) {
    printJson({
      ok: false,
      command: "country info",
      issues: [createCliIssue(error instanceof Error ? error.message : String(error))]
    });
    return 2;
  }
}

async function runCountrySource(args: string[]): Promise<number> {
  const [subcommand] = args;

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printCountrySourceHelp();
    return 0;
  }

  if (subcommand === "lock") {
    return runCountrySourceLock(args.slice(1));
  }

  if (subcommand === "verify") {
    return runCountrySourceVerify(args.slice(1));
  }

  printJson({
    ok: false,
    command: "country source",
    issues: [createCliIssue(`Unsupported country source command '${subcommand}'.`)]
  });
  return 2;
}

async function runCountrySourceLock(args: string[]): Promise<number> {
  const [country] = args;

  if (!country || country === "--help" || country === "-h") {
    printCountrySourceLockHelp();
    return country ? 0 : 2;
  }

  const flags = parseFlags(args.slice(1));
  const config = getTerritoryCountryConfig(country);
  const levels = readCountryLevelsFlag(flags, config.requestedLevels);
  const outputPath = getFlag(flags, "output");
  const metadataPath = getFlag(flags, "metadata") ?? getFlag(flags, "metadata-path");
  const metadataUrl = getFlag(flags, "metadata-url");
  const releaseType = getFlag(flags, "release-type");
  const buildDate = getFlag(flags, "build-date");
  const cacheDir = getFlag(flags, "cache-dir");
  const adm3Provinces = readCommaSeparatedFlag(flags, "adm3-provinces");
  const adm3CatalogPath = getFlag(flags, "adm3-catalog") ?? getFlag(flags, "adm3-catalog-path");
  const flagIssues: CliIssue[] = [];
  const maxSourceBytes = readOptionalPositiveIntegerFlag(flags, "max-source-bytes", flagIssues);

  if (isCliIssueArray(levels)) {
    printJson({ ok: false, command: "country source lock", issues: levels });
    return 2;
  }

  if (flagIssues.length > 0) {
    printJson({ ok: false, command: "country source lock", issues: flagIssues });
    return 2;
  }

  try {
    const result = await createTerritoryCountrySourceLock({
      country,
      levels: levels ?? [...config.requestedLevels],
      ...(releaseType ? { releaseType } : {}),
      ...(adm3Provinces.length > 0 ? { adm3Provinces } : {}),
      ...(adm3CatalogPath ? { adm3CatalogPath } : {}),
      ...(outputPath ? { outputPath } : {}),
      ...(metadataPath ? { metadataPath } : {}),
      ...(metadataUrl ? { metadataUrl } : {}),
      ...(buildDate ? { buildDate } : {}),
      ...(cacheDir ? { cacheDir } : {}),
      ...(flags.has("no-cache") ? { noCache: true } : {}),
      ...(flags.has("refresh") ? { refresh: true } : {}),
      ...(maxSourceBytes ? { maxSourceBytes } : {}),
      ...(flags.has("force") ? { force: true } : {})
    });
    const ok = result.issues.every((issue) => issue.severity !== "error") && Boolean(result.lock);

    printJson({
      ok,
      command: "country source lock",
      data: {
        country: config.countryCodeAlpha2,
        outputPath: result.outputPath,
        lock: result.lock
      },
      issues: result.issues
    });
    return ok ? 0 : 1;
  } catch (error) {
    printJson({
      ok: false,
      command: "country source lock",
      issues: [createCliIssue(error instanceof Error ? error.message : String(error))]
    });
    return 2;
  }
}

async function runCountrySourceVerify(args: string[]): Promise<number> {
  const [lockPath] = args;

  if (!lockPath || lockPath === "--help" || lockPath === "-h") {
    printCountrySourceVerifyHelp();
    return lockPath ? 0 : 2;
  }

  const flags = parseFlags(args.slice(1));
  const buildDate = getFlag(flags, "build-date");

  try {
    const lock = await readTerritoryCountrySourceLockPath(lockPath);
    const result = await verifyTerritoryCountrySourceLock(lock, {
      ...(buildDate ? { buildDate } : {})
    });

    printJson({
      ok: result.ok,
      command: "country source verify",
      data: {
        country: lock.country.alpha2,
        provider: lock.provider,
        levels: Object.keys(lock.levels).sort()
      },
      issues: result.issues
    });
    return result.ok ? 0 : 1;
  } catch (error) {
    printJson({
      ok: false,
      command: "country source verify",
      issues: [createCliIssue(error instanceof Error ? error.message : String(error))]
    });
    return 2;
  }
}

async function runCountryBuild(args: string[]): Promise<number> {
  const [country] = args;

  if (!country || country === "--help" || country === "-h") {
    printCountryBuildHelp();
    return country ? 0 : 2;
  }

  const flags = parseFlags(args.slice(1));
  const sourceLockPath = getFlag(flags, "source-lock");
  const outputPath = getFlag(flags, "output");
  const levels = readCountryLevelsFlag(flags);
  const buildDate = getFlag(flags, "build-date");
  const flagIssues: CliIssue[] = [];
  const batchSize = readOptionalPositiveIntegerFlag(flags, "batch-size", flagIssues);
  const phaseTimeoutMs = readOptionalPositiveIntegerFlag(flags, "phase-timeout-ms", flagIssues);
  const profile = flags.has("profile");
  const profileEvents: CliCountryBuildPhaseEvent[] = [];
  const profileStartedAt = new Date().toISOString();
  const profileStarted = performance.now();

  if (!sourceLockPath || !outputPath) {
    printJson({
      ok: false,
      command: "country build",
      issues: [
        ...(!sourceLockPath ? [createCliIssue("--source-lock is required.")] : []),
        ...(!outputPath ? [createCliIssue("--output is required.")] : [])
      ]
    });
    return 2;
  }

  if (isCliIssueArray(levels)) {
    printJson({ ok: false, command: "country build", issues: levels });
    return 2;
  }

  if (flagIssues.length > 0) {
    printJson({ ok: false, command: "country build", issues: flagIssues });
    return 2;
  }

  try {
    const result = await buildTerritoryCountryDatasetPath({
      country,
      sourceLockPath,
      outputPath,
      ...(levels ? { levels } : {}),
      ...(flags.has("build-adjacency") ? { buildAdjacency: true } : {}),
      ...(flags.has("build-query-artifacts") ? { buildQueryArtifacts: true } : {}),
      ...(flags.has("build-render-artifacts") ? { buildRenderArtifacts: true } : {}),
      ...(flags.has("build-binary-index") ? { buildBinaryIndex: true } : {}),
      ...(flags.has("strict") ? { strict: true } : {}),
      ...(flags.has("allow-partial") ? { allowPartial: true } : {}),
      ...(flags.has("allow-non-publish-ready") || flags.has("allow-partial")
        ? { allowNonPublishReady: true }
        : {}),
      ...(buildDate ? { buildDate } : {}),
      ...(batchSize ? { batchSize } : {}),
      ...(phaseTimeoutMs ? { phaseTimeoutMs } : {}),
      ...(flags.has("force") ? { force: true } : {}),
      ...(profile
        ? {
            onPhase: (event: CliCountryBuildPhaseEvent) => {
              profileEvents.push(event);
            }
          }
        : {})
    });
    const ok = result.issues.every((issue) => issue.severity !== "error");
    const profilePath = profile
      ? await writeCountryBuildPerformanceReport({
          result,
          sourceLockPath,
          requestedLevels: levels ?? result.manifest.supportedLevels,
          profileEvents,
          startedAt: profileStartedAt,
          completedAt: new Date().toISOString(),
          totalDurationMs: Math.round(performance.now() - profileStarted),
          outputPath:
            getFlag(flags, "profile-report") ??
            join(result.outputPath ?? outputPath, "build-performance-report.json")
        })
      : undefined;

    printJson({
      ok,
      command: "country build",
      data: {
        country: result.manifest.country.alpha2,
        outputPath: result.outputPath,
        ...(profilePath ? { profilePath } : {}),
        manifest: result.manifest,
        statistics: result.buildReport.statistics,
        ...(flags.has("json") ? { buildReport: result.buildReport } : {})
      },
      issues: result.issues
    });
    return ok ? 0 : 1;
  } catch (error) {
    printJson({
      ok: false,
      command: "country build",
      issues: [createCliIssue(error instanceof Error ? error.message : String(error))]
    });
    return flags.has("strict") ? 3 : 2;
  }
}

async function writeCountryBuildPerformanceReport(input: {
  result: CliCountryBuildResult;
  sourceLockPath: string;
  requestedLevels: readonly TerritoryAdminLevel[];
  profileEvents: readonly CliCountryBuildPhaseEvent[];
  startedAt: string;
  completedAt: string;
  totalDurationMs: number;
  outputPath: string;
}): Promise<string> {
  const warningCount = input.result.issues.filter((issue) => issue.severity === "warning").length;
  const errorCount = input.result.issues.filter((issue) => issue.severity === "error").length;
  const phaseReports = input.profileEvents
    .filter((event) => event.status !== "started")
    .map((event) => ({
      phase: event.phase,
      status: event.status,
      startedAt: event.startedAt,
      completedAt: event.completedAt ?? event.finishedAt ?? input.completedAt,
      durationMs: event.durationMs,
      ...(event.level ? { level: event.level } : {}),
      ...(event.featureCount !== undefined ? { featureCount: event.featureCount } : {}),
      ...(event.inputBytes !== undefined ? { inputBytes: event.inputBytes } : {}),
      ...(event.outputBytes !== undefined ? { outputBytes: event.outputBytes } : {}),
      ...(event.peakMemoryBytes !== undefined ? { peakMemoryBytes: event.peakMemoryBytes } : {}),
      ...(event.artifactCount !== undefined ? { artifactCount: event.artifactCount } : {}),
      warningCount,
      errorCount,
      ...(event.reason ? { reason: event.reason } : {})
    }));
  const artifactSizes = [...input.result.files.entries()].map(([path, content]) => ({
    path,
    sizeBytes: Buffer.byteLength(content)
  }));
  const peakMemoryBytes = Math.max(
    0,
    readCliMemoryUsageBytes() ?? 0,
    ...phaseReports.map((phase) =>
      typeof phase.peakMemoryBytes === "number" ? phase.peakMemoryBytes : 0
    )
  );
  const report = {
    reportVersion: "1",
    generatedAt: input.completedAt,
    command: "country build",
    country: input.result.manifest.country.alpha2,
    sourceLockPath: input.sourceLockPath,
    sourceLockHash: input.result.manifest.sourceLockHash,
    outputPath: input.result.outputPath,
    requestedLevels: input.requestedLevels,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    totalDurationMs: input.totalDurationMs,
    summary: {
      featureCount: input.result.combinedDataset?.zones.length ?? 0,
      featureCountByLevel: input.result.manifest.featureCountByLevel,
      sourceBytes: input.result.buildReport.statistics.sourceBytes,
      outputBytes: artifactSizes.reduce((sum, artifact) => sum + artifact.sizeBytes, 0),
      artifactCount: artifactSizes.length,
      peakMemoryBytes,
      warningCount,
      errorCount
    },
    phases: phaseReports,
    artifacts: artifactSizes.sort((left, right) => left.path.localeCompare(right.path)),
    adjacency:
      (
        input.result.buildReport.statistics as {
          adjacencyStatisticsByLevel?: Record<string, unknown>;
        }
      ).adjacencyStatisticsByLevel ?? {},
    reports: {
      build: "build-report.json",
      adjacency: "adjacency-report.json",
      mvt: "render/mvt-policy-report.json",
      checksums: "checksums.json",
      coverage: "manifest.json"
    }
  };

  await mkdir(dirname(input.outputPath), { recursive: true });
  await writeFile(input.outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return input.outputPath;
}

function readCliMemoryUsageBytes(): number | undefined {
  if (typeof process === "undefined" || typeof process.memoryUsage !== "function") {
    return undefined;
  }

  return process.memoryUsage().rss;
}

async function runCountryValidate(args: string[]): Promise<number> {
  const [inputPath] = args;

  if (!inputPath || inputPath === "--help" || inputPath === "-h") {
    printCountryValidateHelp();
    return inputPath ? 0 : 2;
  }

  const flags = parseFlags(args.slice(1));

  try {
    const result = await validateTerritoryCountryDatasetPath(inputPath, {
      ...(flags.has("strict") ? { strict: true } : {})
    });

    printJson({
      ok: result.ok,
      command: "country validate",
      data: {
        manifest: result.manifest
      },
      issues: result.issues
    });
    return result.ok ? 0 : 1;
  } catch (error) {
    printJson({
      ok: false,
      command: "country validate",
      issues: [createCliIssue(error instanceof Error ? error.message : String(error))]
    });
    return 2;
  }
}

async function runCountryInspect(args: string[]): Promise<number> {
  const [inputPath] = args;

  if (!inputPath || inputPath === "--help" || inputPath === "-h") {
    printCountryInspectHelp();
    return inputPath ? 0 : 2;
  }

  try {
    const summary = await inspectTerritoryCountryDatasetPath(inputPath);

    printJson({
      ok: true,
      command: "country inspect",
      data: summary
    });
    return 0;
  } catch (error) {
    printJson({
      ok: false,
      command: "country inspect",
      issues: [createCliIssue(error instanceof Error ? error.message : String(error))]
    });
    return 2;
  }
}

async function runGeometry(args: string[]): Promise<number> {
  const [subcommand, inputPath] = args;

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printGeometryHelp();
    return 0;
  }

  if (subcommand !== "validate" && subcommand !== "repair" && subcommand !== "simplify") {
    printJson({
      ok: false,
      command: "geometry",
      issues: [createCliIssue(`Unsupported geometry command '${subcommand}'.`)]
    });
    return 2;
  }

  if (!inputPath || inputPath === "--help" || inputPath === "-h") {
    printGeometryHelp();
    return inputPath ? 0 : 2;
  }

  const flags = parseFlags(args.slice(2));

  try {
    const commonOptions = readGeometryQualityOptions(flags);

    if (Array.isArray(commonOptions)) {
      printJson({ ok: false, command: `geometry ${subcommand}`, issues: commonOptions });
      return 2;
    }

    if (subcommand === "validate") {
      const { input, report } = await validateTerritoryDatasetPath(inputPath, commonOptions);
      const reportPath = getFlag(flags, "report");

      if (reportPath) {
        await writeGeometryQualityReport(reportPath, report);
      }

      printJson({
        ok: report.ok,
        command: "geometry validate",
        data: {
          inputPath: input.sourcePath,
          datasetPath: input.datasetPath,
          datasetId: input.dataset.manifest.datasetId,
          reportPath,
          summary: report.summary,
          report
        },
        issues: report.issues
      });
      return report.ok ? 0 : 1;
    }

    const outputPath = getFlag(flags, "output");

    if (!outputPath) {
      printJson({
        ok: false,
        command: `geometry ${subcommand}`,
        issues: [createCliIssue(`--output is required for geometry ${subcommand}.`)]
      });
      return 2;
    }

    if (subcommand === "simplify") {
      const strategy = getFlag(flags, "strategy") ?? "topology-safe";

      if (strategy !== "topology-safe") {
        printJson({
          ok: false,
          command: "geometry simplify",
          issues: [createCliIssue("--strategy must be topology-safe.")]
        });
        return 2;
      }

      const details = readSimplificationDetailsFlag(flags);

      if (Array.isArray(details) && details.some((detail) => typeof detail !== "string")) {
        printJson({ ok: false, command: "geometry simplify", issues: details });
        return 2;
      }

      const simplifyBuildDate = getFlag(flags, "build-date");
      const result = await simplifyTerritoryDatasetPath(inputPath, outputPath, {
        strategy,
        details: details as Array<"high" | "medium" | "low">,
        ...(simplifyBuildDate ? { buildDate: simplifyBuildDate } : {}),
        ...(flags.has("force") ? { force: true } : {})
      });
      const reportPath = getFlag(flags, "report");

      if (reportPath) {
        await writeFile(reportPath, JSON.stringify(result.report, null, 2) + "\n", "utf8");
      }

      printJson({
        ok: true,
        command: "geometry simplify",
        data: {
          inputPath: result.inputPath,
          outputPath: result.outputPath,
          reportPath,
          report: result.report
        },
        issues: []
      });
      return 0;
    }

    const repairOptions = readGeometryRepairOptions(flags, commonOptions);

    if (Array.isArray(repairOptions)) {
      printJson({ ok: false, command: "geometry repair", issues: repairOptions });
      return 2;
    }

    const repaired = await repairTerritoryDatasetPath(inputPath, outputPath, repairOptions);
    const reportPath = getFlag(flags, "report");

    if (reportPath) {
      await writeGeometryQualityReport(reportPath, repaired.result.report);
    }

    printJson({
      ok: repaired.result.ok,
      command: "geometry repair",
      data: {
        inputPath: repaired.input.sourcePath,
        datasetPath: repaired.input.datasetPath,
        outputPath: repaired.outputPath,
        reportPath,
        summary: repaired.result.report.summary,
        repairSummary: repaired.result.repairSummary,
        report: repaired.result.report
      },
      issues: repaired.result.report.issues
    });
    return repaired.result.ok ? 0 : 3;
  } catch (error) {
    printJson({
      ok: false,
      command: `geometry ${subcommand}`,
      issues: [createCliIssue(error instanceof Error ? error.message : String(error))]
    });
    return 2;
  }
}

async function runAdjacency(args: string[]): Promise<number> {
  const [subcommand] = args;

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printAdjacencyHelp();
    return 0;
  }

  if (subcommand === "build") {
    return runAdjacencyBuild(args.slice(1));
  }

  if (subcommand === "validate") {
    return runAdjacencyValidate(args.slice(1));
  }

  if (subcommand === "inspect") {
    return runAdjacencyInspect(args.slice(1));
  }

  return runLegacyBBoxAdjacency(subcommand);
}

async function runLegacyBBoxAdjacency(filePath: string): Promise<number> {
  const input = await readJson(filePath);
  const dataset = loadTerritoryDataset(input);

  printJson({
    ok: true,
    command: "adjacency",
    data: {
      note: "inferBBoxAdjacency is a bbox-based development helper; use 'territory adjacency build' for polygon adjacency.",
      adjacency: inferBBoxAdjacency(dataset.zones),
      connections: inferBBoxAdjacencyConnections(dataset.zones)
    }
  });
  return 0;
}

async function runAdjacencyBuild(args: string[]): Promise<number> {
  const [inputPath] = args;

  if (!inputPath || inputPath === "--help" || inputPath === "-h") {
    printAdjacencyBuildHelp();
    return inputPath ? 0 : 2;
  }

  const flags = parseFlags(args.slice(1));
  const outputPath = getFlag(flags, "output");

  if (!outputPath) {
    printJson({
      ok: false,
      command: "adjacency build",
      issues: [createCliIssue("--output is required for adjacency build.")]
    });
    return 2;
  }

  const options = readAdjacencyBuildOptions(flags);

  if (Array.isArray(options)) {
    printJson({ ok: false, command: "adjacency build", issues: options });
    return 2;
  }

  try {
    const reportPath = getFlag(flags, "report");
    const overridesPath = getFlag(flags, "overrides");
    const buildDate = getFlag(flags, "build-date");
    const result = await buildTerritoryAdjacencyPath(inputPath, {
      ...options,
      outputPath,
      ...(reportPath ? { reportPath } : {}),
      ...(overridesPath ? { overridesPath } : {}),
      ...(buildDate ? { buildDate } : {}),
      ...(flags.has("force") ? { force: true } : {})
    });
    const ok = result.result.issues.every((issue) => issue.severity !== "error");

    printJson({
      ok,
      command: "adjacency build",
      data: {
        inputPath: result.input.sourcePath,
        datasetPath: result.input.datasetPath,
        outputPath: result.outputPath,
        reportPath: result.reportPath,
        statistics: result.result.statistics,
        ...(flags.has("json") ? { artifact: result.result.artifact } : {})
      },
      issues: result.result.issues
    });
    return ok ? 0 : 1;
  } catch (error) {
    printJson({
      ok: false,
      command: "adjacency build",
      issues: [createCliIssue(error instanceof Error ? error.message : String(error))]
    });
    return flags.has("strict") ? 3 : 2;
  }
}

async function runAdjacencyValidate(args: string[]): Promise<number> {
  const [datasetPath, adjacencyPath] = args;

  if (!datasetPath || !adjacencyPath || datasetPath === "--help" || datasetPath === "-h") {
    printAdjacencyValidateHelp();
    return datasetPath ? 0 : 2;
  }

  try {
    const result = await validateTerritoryAdjacencyPath(datasetPath, adjacencyPath);

    printJson({
      ok: result.report.ok,
      command: "adjacency validate",
      data: {
        datasetId: result.dataset.manifest.datasetId,
        edgeCount: result.artifact.edges.length,
        report: result.report
      },
      issues: result.report.issues
    });
    return result.report.ok ? 0 : 1;
  } catch (error) {
    printJson({
      ok: false,
      command: "adjacency validate",
      issues: [createCliIssue(error instanceof Error ? error.message : String(error))]
    });
    return 2;
  }
}

async function runAdjacencyInspect(args: string[]): Promise<number> {
  const [adjacencyPath, zoneId] = args;

  if (!adjacencyPath || !zoneId || adjacencyPath === "--help" || adjacencyPath === "-h") {
    printAdjacencyInspectHelp();
    return adjacencyPath ? 0 : 2;
  }

  const flags = parseFlags(args.slice(2));
  const types = readAdjacencyTypesFlag(flags);

  if (Array.isArray(types) && types.some((type) => typeof type !== "string")) {
    printJson({ ok: false, command: "adjacency inspect", issues: types });
    return 2;
  }

  try {
    const artifact = await readTerritoryAdjacencyArtifactPath(adjacencyPath);
    const index = createTerritoryAdjacencyIndex(artifact);
    const queryOptions = types ? { types: types as TerritoryAdjacencyType[] } : {};
    const neighbors = index.getNeighbors(zoneId, queryOptions);
    const relations = neighbors.flatMap((neighborId) =>
      index.getRelation(zoneId, neighborId, queryOptions)
    );

    if (flags.has("json")) {
      printJson({
        ok: true,
        command: "adjacency inspect",
        data: {
          zoneId,
          neighbors,
          relations
        }
      });
    } else {
      printAdjacencyInspection(zoneId, neighbors, relations);
    }

    return 0;
  } catch (error) {
    printJson({
      ok: false,
      command: "adjacency inspect",
      issues: [createCliIssue(error instanceof Error ? error.message : String(error))]
    });
    return 2;
  }
}

async function runDataset(args: string[]): Promise<number> {
  const [subcommand, datasetId] = args;

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printDatasetHelp();
    return 0;
  }

  if (subcommand === "search") {
    return runDatasetSearch(args.slice(1));
  }

  if (subcommand === "info") {
    return runDatasetInfo(args.slice(1));
  }

  if (subcommand === "resolve") {
    return runDatasetResolve(args.slice(1));
  }

  if (subcommand === "install") {
    return runDatasetInstall(args.slice(1));
  }

  if (subcommand === "update") {
    return runDatasetInstall(args.slice(1), { update: true });
  }

  if (subcommand === "verify") {
    return runDatasetVerify(args.slice(1));
  }

  if (subcommand === "remove") {
    return runDatasetRemove(args.slice(1));
  }

  if (subcommand === "list-installed") {
    return runDatasetListInstalled(args.slice(1));
  }

  if (subcommand === "coverage") {
    return runDatasetCoverage(args.slice(1));
  }

  if (subcommand === "diff") {
    return runDatasetDiff(args.slice(1));
  }

  if (subcommand === "migration-plan") {
    return runDatasetMigrationPlan(args.slice(1));
  }

  if (subcommand === "build-all") {
    return runDatasetBuildAll(args.slice(1));
  }

  if (subcommand !== "build") {
    printJson({
      ok: false,
      command: "dataset",
      issues: [createCliIssue(`Unsupported dataset command '${subcommand}'.`)]
    });
    return 1;
  }

  if (!datasetId || datasetId === "--help" || datasetId === "-h") {
    printDatasetBuildHelp();
    return datasetId ? 0 : 1;
  }

  const flags = parseFlags(args.slice(2));

  if (datasetId === GLOBAL_ADMIN_DATASET_ID || datasetId === "global-admin-adm0") {
    return runGlobalAdminAdm0Build(args.slice(2));
  }

  if (datasetId !== WORLD_COUNTRIES_DATASET_ID) {
    printJson({
      ok: false,
      command: "dataset build",
      issues: [createCliIssue(`Unknown dataset '${datasetId}'.`)]
    });
    return 1;
  }

  const sourcePath = getFlag(flags, "source");
  const outputPath = getFlag(flags, "output");

  if (!sourcePath) {
    printJson({
      ok: false,
      command: "dataset build",
      issues: [createCliIssue("--source is required for dataset builds.")]
    });
    return 1;
  }

  if (!outputPath) {
    printJson({
      ok: false,
      command: "dataset build",
      issues: [createCliIssue("--output is required for dataset builds.")]
    });
    return 1;
  }

  const detail = getFlag(flags, "detail");
  const details = detail ? readDetailFlag(detail) : undefined;

  if (detail && !details) {
    printJson({
      ok: false,
      command: "dataset build",
      issues: [createCliIssue(`Invalid --detail '${detail}'. Expected low, medium, or high.`)]
    });
    return 1;
  }

  const sourceVersion = getFlag(flags, "source-version");
  const sourceUrl = getFlag(flags, "source-url");
  const sourceSha256 = getFlag(flags, "source-sha256");
  const sourceDate = getFlag(flags, "source-date");
  const buildDate = getFlag(flags, "build-date");
  const datasetVersion = getFlag(flags, "dataset-version");
  const result = await buildWorldCountriesDatasetFromSourcePipeline({
    sourcePath,
    outputPath,
    ...(details ? { details } : {}),
    ...(sourceVersion ? { sourceVersion } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(sourceSha256 ? { sourceSha256 } : {}),
    ...(sourceDate ? { sourceDate } : {}),
    ...(buildDate ? { buildDate } : {}),
    ...(datasetVersion ? { datasetVersion } : {}),
    ...(flags.has("force") ? { force: true } : {}),
    ...(flags.has("strict") ? { strict: true } : {})
  });

  printJson({
    ok: result.ok,
    command: "dataset build",
    ...(result.ok
      ? {
          data: {
            ...result.summary,
            manifest: result.manifest,
            checksums: result.checksums
          },
          issues: result.issues
        }
      : { issues: result.issues })
  });
  return result.ok ? 0 : 1;
}

async function runIdentity(args: string[]): Promise<number> {
  const [subcommand] = args;

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printIdentityHelp();
    return 0;
  }

  if (subcommand === "diff") {
    return runDatasetDiff(args.slice(1), { identityOnly: true });
  }

  printJson({
    ok: false,
    command: "identity",
    issues: [createCliIssue(`Unsupported identity command '${subcommand}'.`)]
  });
  return 2;
}

async function runDatasetDiff(args: string[], options: CliDiffRunOptions = {}): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    printDatasetDiffHelp(options.identityOnly === true);
    return 0;
  }

  const flags = parseFlags(args);
  const [oldPath, newPath] = getPositionalArgs(args);

  if (!oldPath || !newPath) {
    printJson({
      ok: false,
      command: options.identityOnly ? "identity diff" : "dataset diff",
      issues: [
        createCliIssue(
          options.identityOnly
            ? "Usage: territory identity diff <old-dataset.json> <new-dataset.json>."
            : "Usage: territory dataset diff <old-dataset.json> <new-dataset.json>."
        )
      ]
    });
    return 2;
  }

  try {
    const oldDataset = await readDiffDatasetInput(oldPath);
    const newDataset = await readDiffDatasetInput(newPath);
    const report = options.identityOnly
      ? diffIdentities(oldDataset, newDataset, readDiffOptions(flags))
      : diffDatasets(oldDataset, newDataset, readDiffOptions(flags));
    const command = options.identityOnly ? "identity diff" : "dataset diff";

    await writeDatasetDiffOutputs(report, flags);
    printDatasetDiffOutput(report, flags, command);

    if (flags.has("fail-on-review") && report.summary.requiresReviewCount > 0) {
      return 1;
    }

    if (flags.has("fail-on-breaking") && report.summary.breakingChangeCount > 0) {
      return 1;
    }

    return 0;
  } catch (error) {
    printJson({
      ok: false,
      command: options.identityOnly ? "identity diff" : "dataset diff",
      issues: [createCliIssue(error instanceof Error ? error.message : String(error))]
    });
    return 2;
  }
}

async function runDatasetMigrationPlan(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    printDatasetMigrationPlanHelp();
    return 0;
  }

  const flags = parseFlags(args);
  const [oldPath, newPath] = getPositionalArgs(args);

  if (!oldPath || !newPath) {
    printJson({
      ok: false,
      command: "dataset migration-plan",
      issues: [
        createCliIssue(
          "Usage: territory dataset migration-plan <old-dataset.json> <new-dataset.json>."
        )
      ]
    });
    return 2;
  }

  try {
    const oldDataset = await readDiffDatasetInput(oldPath);
    const newDataset = await readDiffDatasetInput(newPath);
    const plan = createMigrationPlan(oldDataset, newDataset, readDiffOptions(flags));
    const validation = validateMigrationPlan(plan);

    await writeMigrationPlanOutputs(plan, flags);
    printMigrationPlanOutput(plan, validation.ok, flags);

    if (!validation.ok) {
      return 1;
    }

    if (flags.has("fail-on-review") && plan.summary.requiresReviewCount > 0) {
      return 1;
    }

    if (flags.has("fail-on-breaking") && plan.summary.breakingChangeCount > 0) {
      return 1;
    }

    return 0;
  } catch (error) {
    printJson({
      ok: false,
      command: "dataset migration-plan",
      issues: [createCliIssue(error instanceof Error ? error.message : String(error))]
    });
    return 2;
  }
}

async function runGlobalAdminAdm0Build(args: string[]): Promise<number> {
  const flags = parseFlags(args);
  const sourcePath = getFlag(flags, "source");
  const sourceUrl = getFlag(flags, "source-url") ?? NATURAL_EARTH_ADM0_GEOJSON_URL;
  const outputPath = getFlag(flags, "output") ?? GLOBAL_ADMIN_ADM0_OUTPUT;
  const buildDate = getFlag(flags, "build-date");
  const datasetVersion = getFlag(flags, "dataset-version");
  const sourceDate = getFlag(flags, "source-date");
  const sourceVersion = getFlag(flags, "source-version");
  const cacheDir = getFlag(flags, "cache-dir");
  const buildReportPath = getFlag(flags, "build-report");
  const artifactRootsFlag =
    getFlag(flags, "country-artifact-root") ?? getFlag(flags, "artifact-root");
  const countryArtifactRoots = artifactRootsFlag
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  try {
    const result = await buildGlobalAdminAdm0Artifacts({
      ...(sourcePath ? { sourcePath } : {}),
      sourceUrl,
      outputPath,
      ...(countryArtifactRoots && countryArtifactRoots.length > 0 ? { countryArtifactRoots } : {}),
      ...(buildReportPath ? { buildReportPath } : {}),
      ...(buildDate ? { buildDate } : {}),
      ...(datasetVersion ? { datasetVersion } : {}),
      ...(sourceDate ? { sourceDate } : {}),
      ...(sourceVersion ? { sourceVersion } : {}),
      ...(cacheDir ? { cacheDir } : {}),
      ...(flags.has("force") ? { force: true } : {})
    });

    printJson({
      ok: result.ok,
      command: "dataset build global-admin",
      data: {
        outputPath: result.outputPath,
        featureCount: result.featureCount,
        validatedArtifactCount: result.validatedArtifactCount,
        smoke: result.smoke
      },
      issues: result.issues
    });
    return result.ok ? 0 : 1;
  } catch (error) {
    printJson({
      ok: false,
      command: "dataset build global-admin",
      issues: [createCliIssue(error instanceof Error ? error.message : String(error))]
    });
    return 1;
  }
}

async function runDatasetBuildAll(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    printDatasetBuildAllHelp();
    return 0;
  }

  const flags = parseFlags(args);
  const outputRoot = getFlag(flags, "output") ?? "datasets/generated/countries";
  const reportPath = getFlag(flags, "report");
  const levels = readCountryLevelsFlag(flags, ["ADM1", "ADM2"]);
  const countriesFlag = getFlag(flags, "countries") ?? getFlag(flags, "country");
  const countries = countriesFlag
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const excludeFlag = getFlag(flags, "exclude");
  const excludeCountries = excludeFlag
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const concurrency = Number(getFlag(flags, "concurrency") ?? "2");
  const countryTimeoutMs = getFlag(flags, "country-timeout-ms")
    ? Number(getFlag(flags, "country-timeout-ms"))
    : undefined;
  const phaseTimeoutMs = getFlag(flags, "phase-timeout-ms")
    ? Number(getFlag(flags, "phase-timeout-ms"))
    : undefined;
  const releaseType = getFlag(flags, "release-type");
  const provider = getFlag(flags, "provider");
  const buildDate = getFlag(flags, "build-date");
  const cacheDir = getFlag(flags, "cache-dir");
  const maxSourceBytes = getFlag(flags, "max-source-bytes")
    ? Number(getFlag(flags, "max-source-bytes"))
    : undefined;

  if (isCliIssueArray(levels)) {
    printJson({ ok: false, command: "dataset build-all", issues: levels });
    return 2;
  }

  if (!Number.isInteger(concurrency) || concurrency < 1) {
    printJson({
      ok: false,
      command: "dataset build-all",
      issues: [createCliIssue("--concurrency must be a positive integer.")]
    });
    return 2;
  }

  if (maxSourceBytes !== undefined && (!Number.isInteger(maxSourceBytes) || maxSourceBytes < 1)) {
    printJson({
      ok: false,
      command: "dataset build-all",
      issues: [createCliIssue("--max-source-bytes must be a positive integer.")]
    });
    return 2;
  }

  if (
    countryTimeoutMs !== undefined &&
    (!Number.isInteger(countryTimeoutMs) || countryTimeoutMs < 1)
  ) {
    printJson({
      ok: false,
      command: "dataset build-all",
      issues: [createCliIssue("--country-timeout-ms must be a positive integer.")]
    });
    return 2;
  }

  if (phaseTimeoutMs !== undefined && (!Number.isInteger(phaseTimeoutMs) || phaseTimeoutMs < 1)) {
    printJson({
      ok: false,
      command: "dataset build-all",
      issues: [createCliIssue("--phase-timeout-ms must be a positive integer.")]
    });
    return 2;
  }

  try {
    const report = await buildAllTerritoryCountryDatasets({
      levels: levels ?? ["ADM1", "ADM2"],
      outputRoot,
      ...(reportPath ? { reportPath } : {}),
      ...(countries && countries.length > 0 ? { countries } : {}),
      ...(excludeCountries && excludeCountries.length > 0 ? { excludeCountries } : {}),
      concurrency,
      ...(releaseType ? { releaseType } : {}),
      ...(provider ? { provider } : {}),
      ...(buildDate ? { buildDate } : {}),
      ...(cacheDir ? { cacheDir } : {}),
      ...(maxSourceBytes ? { maxSourceBytes } : {}),
      ...(countryTimeoutMs ? { countryTimeoutMs } : {}),
      ...(phaseTimeoutMs ? { phaseTimeoutMs } : {}),
      ...(flags.has("skip-adjacency") ? { buildAdjacency: false } : {}),
      onPhase: (event) => {
        process.stderr.write(`${JSON.stringify(event)}\n`);
      },
      ...(flags.has("continue-on-error") ? { continueOnError: true } : {}),
      ...(flags.has("resume") ? { resume: true } : {}),
      ...(flags.has("retry-failed") ? { retryFailed: true } : {}),
      ...(flags.has("offline") ? { offline: true } : {}),
      ...(flags.has("force") ? { force: true } : {})
    });
    const ok =
      report.countriesFailed === 0 || flags.has("continue-on-error") || flags.has("allow-partial");

    printJson({
      ok,
      command: "dataset build-all",
      data: report
    });
    return ok ? 0 : 1;
  } catch (error) {
    printJson({
      ok: false,
      command: "dataset build-all",
      issues: [createCliIssue(error instanceof Error ? error.message : String(error))]
    });
    return 1;
  }
}

async function runDatasetCoverage(args: string[]): Promise<number> {
  const flags = parseFlags(args);
  const coveragePath = getFlag(flags, "input") ?? "datasets/registry/coverage.json";
  const selectedLevels = readCountryLevelsFlag(flags);

  if (isCliIssueArray(selectedLevels)) {
    printJson({ ok: false, command: "dataset coverage", issues: selectedLevels });
    return 2;
  }

  try {
    const coverageInput = flags.has("from-artifacts")
      ? await buildTerritoryCoverageRegistryFromArtifacts({
          generatedAt: getFlag(flags, "build-date") ?? new Date().toISOString(),
          artifactRoot: getFlag(flags, "artifact-root") ?? "datasets/generated/countries",
          globalAdm0Path: getFlag(flags, "global-adm0") ?? GLOBAL_ADMIN_ADM0_OUTPUT,
          ...(getFlag(flags, "build-report")
            ? { buildReportPath: getFlag(flags, "build-report") as string }
            : {})
        })
      : await readCoverageRegistry(coveragePath, flags.has("input"));
    const coverage = selectedLevels
      ? filterCoverageRegistryLevels(coverageInput, selectedLevels)
      : coverageInput;
    const outputPath = getFlag(flags, "output");

    if (outputPath) {
      await writeJsonOutput(outputPath, coverage, flags.has("force"));
    }

    if (flags.has("json")) {
      printJson({
        ok: true,
        command: "dataset coverage",
        data: coverage
      });
    } else {
      printDatasetCoverageSummary(coverage);
    }

    return 0;
  } catch (error) {
    printJson({
      ok: false,
      command: "dataset coverage",
      issues: [createCliIssue(error instanceof Error ? error.message : String(error))]
    });
    return 1;
  }
}

async function readCoverageRegistry(inputPath: string, explicit: boolean): Promise<unknown> {
  if (explicit) {
    return readJson(inputPath);
  }

  const candidates = [
    inputPath,
    join(process.cwd(), inputPath),
    join(process.cwd(), "..", inputPath),
    join(process.cwd(), "..", "..", inputPath)
  ];
  let lastError: unknown;

  for (const candidate of candidates) {
    try {
      return await readJson(candidate);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`Unable to read ${inputPath}.`);
}

async function readDiffDatasetInput(inputPath: string): Promise<TerritoryDataset> {
  const input = await readJson(inputPath);

  if (!isRecordValue(input) || !isRecordValue(input.manifest) || !Array.isArray(input.zones)) {
    throw new Error(`Diff input '${inputPath}' must be a TerritoryKit dataset object.`);
  }

  return input as unknown as TerritoryDataset;
}

function readDiffOptions(flags: Map<string, string | true>) {
  const issues: CliIssue[] = [];
  const automaticConfidenceThreshold = readOptionalNonNegativeNumberFlag(
    flags,
    "automatic-confidence-threshold",
    issues
  );
  const geometryCandidateMinConfidence = readOptionalNonNegativeNumberFlag(
    flags,
    "geometry-candidate-min-confidence",
    issues
  );

  if (automaticConfidenceThreshold !== undefined && automaticConfidenceThreshold > 1) {
    issues.push(createCliIssue("--automatic-confidence-threshold must be between 0 and 1."));
  }

  if (geometryCandidateMinConfidence !== undefined && geometryCandidateMinConfidence > 1) {
    issues.push(createCliIssue("--geometry-candidate-min-confidence must be between 0 and 1."));
  }

  if (issues.length > 0) {
    throw new Error(issues.map((issue) => issue.message).join(" "));
  }

  return {
    ...(automaticConfidenceThreshold !== undefined ? { automaticConfidenceThreshold } : {}),
    ...(geometryCandidateMinConfidence !== undefined ? { geometryCandidateMinConfidence } : {})
  };
}

async function writeDatasetDiffOutputs(
  report: TerritoryDatasetDiffReport,
  flags: Map<string, string | true>
): Promise<void> {
  const force = flags.has("force");
  const outputPath = getFlag(flags, "output");
  const format = readDatasetDiffFormat(flags);

  if (outputPath) {
    await writeTextOutput(outputPath, formatDatasetDiffPayload(report, format), force);
  }

  const jsonOutput = getFlag(flags, "json-output");
  if (jsonOutput) {
    await writeJsonOutput(jsonOutput, report, force);
  }

  const markdownOutput = getFlag(flags, "markdown-output");
  if (markdownOutput) {
    await writeTextOutput(markdownOutput, formatDatasetDiffMarkdown(report), force);
  }

  const csvOutput = getFlag(flags, "csv-output");
  if (csvOutput) {
    await writeTextOutput(csvOutput, formatDatasetDiffCsv(report), force);
  }

  const mappingOutput = getFlag(flags, "mapping-output");
  if (mappingOutput) {
    await writeJsonOutput(mappingOutput, createMigrationMappingFromReport(report), force);
  }

  const breakingOutput = getFlag(flags, "breaking-output");
  if (breakingOutput) {
    await writeJsonOutput(breakingOutput, report.breakingChanges, force);
  }

  const coverageOutput = getFlag(flags, "coverage-output");
  if (coverageOutput) {
    await writeJsonOutput(coverageOutput, report.coverageChangeReport, force);
  }

  const performanceOutput = getFlag(flags, "performance-output");
  if (performanceOutput) {
    await writeJsonOutput(performanceOutput, report.performance, force);
  }
}

async function writeMigrationPlanOutputs(
  plan: TerritoryDatasetMigrationPlan,
  flags: Map<string, string | true>
): Promise<void> {
  const force = flags.has("force");
  const outputPath = getFlag(flags, "output");

  if (outputPath) {
    await writeTextOutput(
      outputPath,
      formatMigrationPlanPayload(plan, readMigrationPlanFormat(flags)),
      force
    );
  }

  const mappingOutput = getFlag(flags, "mapping-output");
  if (mappingOutput) {
    await writeJsonOutput(mappingOutput, plan, force);
  }
}

function printDatasetDiffOutput(
  report: TerritoryDatasetDiffReport,
  flags: Map<string, string | true>,
  command: string
): void {
  const format = readDatasetDiffFormat(flags);

  if (format === "json") {
    printJson({ ok: true, command, data: report });
    return;
  }

  console.log(formatDatasetDiffPayload(report, format));
}

function printMigrationPlanOutput(
  plan: TerritoryDatasetMigrationPlan,
  validationOk: boolean,
  flags: Map<string, string | true>
): void {
  const format = readMigrationPlanFormat(flags);

  if (format === "json") {
    printJson({ ok: validationOk, command: "dataset migration-plan", data: plan });
    return;
  }

  console.log(formatMigrationPlanPayload(plan, format));
}

function readDatasetDiffFormat(
  flags: Map<string, string | true>
): "markdown" | "json" | "csv" | "mapping" | "breaking" | "coverage" {
  if (flags.has("json")) {
    return "json";
  }

  if (flags.has("csv")) {
    return "csv";
  }

  if (flags.has("markdown")) {
    return "markdown";
  }

  const format = getFlag(flags, "format");

  if (
    format === "markdown" ||
    format === "json" ||
    format === "csv" ||
    format === "mapping" ||
    format === "breaking" ||
    format === "coverage"
  ) {
    return format;
  }

  if (format) {
    throw new Error("--format must be markdown, json, csv, mapping, breaking, or coverage.");
  }

  return "markdown";
}

function readMigrationPlanFormat(flags: Map<string, string | true>): "json" | "markdown" {
  if (flags.has("markdown")) {
    return "markdown";
  }

  const format = getFlag(flags, "format");

  if (format === "json" || format === "markdown") {
    return format;
  }

  if (format) {
    throw new Error("--format must be json or markdown.");
  }

  return "json";
}

function formatDatasetDiffPayload(
  report: TerritoryDatasetDiffReport,
  format: "markdown" | "json" | "csv" | "mapping" | "breaking" | "coverage"
): string {
  if (format === "json") {
    return `${JSON.stringify(report, null, 2)}\n`;
  }

  if (format === "csv") {
    return formatDatasetDiffCsv(report);
  }

  if (format === "mapping") {
    return `${JSON.stringify(createMigrationMappingFromReport(report), null, 2)}\n`;
  }

  if (format === "breaking") {
    return `${JSON.stringify(report.breakingChanges, null, 2)}\n`;
  }

  if (format === "coverage") {
    return `${JSON.stringify(report.coverageChangeReport, null, 2)}\n`;
  }

  return formatDatasetDiffMarkdown(report);
}

function formatMigrationPlanPayload(
  plan: TerritoryDatasetMigrationPlan,
  format: "json" | "markdown"
): string {
  if (format === "markdown") {
    return formatMigrationPlanMarkdown(plan);
  }

  return `${JSON.stringify(plan, null, 2)}\n`;
}

function formatDatasetDiffMarkdown(report: TerritoryDatasetDiffReport): string {
  const lines = [
    `# Territory Dataset Diff`,
    "",
    `From: ${formatDatasetRef(report.fromDataset)}`,
    `To: ${formatDatasetRef(report.toDataset)}`,
    "",
    `## Summary`,
    "",
    `- Old zones: ${report.summary.oldZoneCount}`,
    `- New zones: ${report.summary.newZoneCount}`,
    `- Changes: ${report.summary.changedCount}`,
    `- Unchanged matches: ${report.summary.unchangedCount}`,
    `- Requires review: ${report.summary.requiresReviewCount}`,
    `- Breaking changes: ${report.summary.breakingChangeCount}`,
    "",
    `## Categories`,
    "",
    `| Category | Count |`,
    `| --- | ---: |`,
    ...Object.entries(report.summary.countsByCategory).map(
      ([category, count]) => `| ${category} | ${count} |`
    ),
    "",
    `## Changes`,
    ""
  ];

  if (report.changes.length === 0) {
    lines.push("No changes detected.");
  } else {
    lines.push("| Category | Old ID | New ID | Confidence | Review | Reason |");
    lines.push("| --- | --- | --- | ---: | --- | --- |");
    for (const change of report.changes) {
      lines.push(
        [
          change.category,
          change.oldId ?? change.oldIds?.join(", ") ?? "",
          change.newId ?? change.newIds?.join(", ") ?? "",
          change.confidence.toFixed(3),
          change.requiresReview ? "yes" : "no",
          escapeMarkdownCell(change.reason)
        ]
          .join(" | ")
          .replace(/^/, "| ")
          .replace(/$/, " |")
      );
    }
  }

  lines.push("", "## Breaking Changes", "");

  if (report.breakingChanges.length === 0) {
    lines.push("No breaking changes detected.");
  } else {
    for (const change of report.breakingChanges) {
      lines.push(`- ${change.code}: ${change.message}`);
    }
  }

  lines.push("", "## Coverage", "", formatCoverageChangeMarkdown(report.coverageChangeReport));
  lines.push("", "## Performance", "");
  lines.push(`- Candidate pairs evaluated: ${report.performance.candidatePairCount}`);
  lines.push(`- Spatial candidates retained: ${report.performance.spatialCandidateCount}`);
  lines.push(`- Estimated memory bytes: ${report.performance.estimatedMemoryBytes}`);
  lines.push(`- Streaming recommended: ${report.performance.streamingRecommended ? "yes" : "no"}`);

  return `${lines.join("\n")}\n`;
}

function formatMigrationPlanMarkdown(plan: TerritoryDatasetMigrationPlan): string {
  const lines = [
    `# Territory Dataset Migration Plan`,
    "",
    `From: ${formatDatasetRef(plan.fromDataset)}`,
    `To: ${formatDatasetRef(plan.toDataset)}`,
    "",
    `- Automatic mappings: ${plan.summary.automaticMappingCount}`,
    `- Total mappings: ${plan.summary.totalMappingCount}`,
    `- Requires review: ${plan.summary.requiresReviewCount}`,
    `- Breaking changes: ${plan.summary.breakingChangeCount}`,
    "",
    `## Mappings`,
    "",
    `| Old ID | New ID | Type | Confidence | Review |`,
    `| --- | --- | --- | ---: | --- |`
  ];

  for (const mapping of plan.mappings) {
    lines.push(
      `| ${mapping.oldId} | ${mapping.newId} | ${mapping.type} | ${mapping.confidence.toFixed(3)} | ${mapping.requiresReview ? "yes" : "no"} |`
    );
  }

  lines.push("", "## Manual Review", "");

  if (plan.reviewItems.length === 0) {
    lines.push("No manual review items.");
  } else {
    for (const item of plan.reviewItems) {
      lines.push(`- ${item.category}: ${item.reason}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function formatDatasetDiffCsv(report: TerritoryDatasetDiffReport): string {
  const rows = [
    ["category", "oldId", "newId", "confidence", "requiresReview", "breaking", "reason"],
    ...report.changes.map((change) => [
      change.category,
      change.oldId ?? change.oldIds?.join(";") ?? "",
      change.newId ?? change.newIds?.join(";") ?? "",
      change.confidence.toFixed(6),
      String(change.requiresReview),
      String(change.breaking),
      change.reason
    ])
  ];

  return `${rows.map((row) => row.map(escapeCsvCell).join(",")).join("\n")}\n`;
}

function formatCoverageChangeMarkdown(report: TerritoryCoverageChangeReport): string {
  const lines = [
    `Zone count: ${report.zoneCount.old} -> ${report.zoneCount.new} (${report.zoneCount.delta >= 0 ? "+" : ""}${report.zoneCount.delta})`,
    "",
    `| Level | Old | New | Delta |`,
    `| --- | ---: | ---: | ---: |`,
    ...report.byLevel.map(
      (entry) => `| ${entry.key} | ${entry.old} | ${entry.new} | ${entry.delta} |`
    ),
    "",
    `| Country | Old | New | Delta |`,
    `| --- | ---: | ---: | ---: |`,
    ...report.byCountry.map(
      (entry) => `| ${entry.key} | ${entry.old} | ${entry.new} | ${entry.delta} |`
    )
  ];

  return lines.join("\n");
}

function createMigrationMappingFromReport(
  report: TerritoryDatasetDiffReport
): TerritoryDatasetMigrationPlan {
  const migrationMatches = report.matches.filter(
    (match) => !match.categories.includes("stable-id-conflict")
  );

  return {
    schemaVersion: "territory-migration-plan@1",
    fromDataset: report.fromDataset,
    toDataset: report.toDataset,
    mappings: migrationMatches.map((match) => ({
      oldId: match.oldId,
      newId: match.newId,
      type: selectCliMigrationMappingType(match.categories),
      confidence: match.confidence,
      requiresReview: match.requiresReview,
      categories: match.categories,
      strategy: match.strategy
    })),
    reviewItems: report.changes
      .filter((change) => change.requiresReview)
      .map((change) => ({
        category: change.category,
        reason: change.reason,
        confidence: change.confidence,
        ...(change.oldId ? { oldId: change.oldId } : {}),
        ...(change.newId ? { newId: change.newId } : {}),
        ...(change.oldIds ? { oldIds: change.oldIds } : {}),
        ...(change.newIds ? { newIds: change.newIds } : {})
      })),
    breakingChanges: report.breakingChanges,
    summary: {
      automaticMappingCount: migrationMatches.filter((match) => !match.requiresReview).length,
      breakingChangeCount: report.breakingChanges.length,
      requiresReviewCount: report.summary.requiresReviewCount,
      totalMappingCount: migrationMatches.length
    }
  };
}

function selectCliMigrationMappingType(
  categories: TerritoryDatasetDiffReport["matches"][number]["categories"]
): TerritoryDatasetMigrationPlan["mappings"][number]["type"] {
  for (const category of [
    "renamed",
    "reparented",
    "geometry-changed",
    "metadata-changed",
    "license-changed",
    "source-changed"
  ] as const) {
    if (categories.includes(category)) {
      return category;
    }
  }

  return "unchanged";
}

function formatDatasetRef(ref: TerritoryDatasetDiffReport["fromDataset"]): string {
  return `${ref.datasetId}@${ref.datasetVersion}`;
}

function escapeMarkdownCell(input: string): string {
  return input.replaceAll("|", "\\|").replace(/\s+/g, " ");
}

function escapeCsvCell(input: string): string {
  if (!/[",\n\r]/.test(input)) {
    return input;
  }

  return `"${input.replaceAll('"', '""')}"`;
}

async function runRender(args: string[]): Promise<number> {
  const [subcommand] = args;

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printRenderHelp();
    return 0;
  }

  if (subcommand === "build") {
    const [datasetPath] = args.slice(1).filter((value) => !value.startsWith("--"));
    const flags = parseFlags(args.slice(1));
    const outputPath = getFlag(flags, "output");
    const format = getFlag(flags, "format") ?? "mvt";

    if (!datasetPath || !outputPath) {
      printJson({
        ok: false,
        command: "render build",
        issues: [createCliIssue("Dataset path and --output are required.")]
      });
      return 1;
    }

    if (format !== "mvt" && format !== "geojson") {
      printJson({
        ok: false,
        command: "render build",
        issues: [createCliIssue("--format must be mvt or geojson.")]
      });
      return 1;
    }

    const layerId = getFlag(flags, "layer");
    const minZoom = getOptionalNumberFlag(flags, "min-zoom");
    const maxZoom = getOptionalNumberFlag(flags, "max-zoom");
    const buildDate = getFlag(flags, "build-date");
    const result = await buildTerritoryRenderArtifactPath({
      inputPath: datasetPath,
      outputPath,
      format,
      ...(layerId ? { layerId } : {}),
      ...(minZoom !== undefined ? { minZoom } : {}),
      ...(maxZoom !== undefined ? { maxZoom } : {}),
      ...(buildDate ? { buildDate } : {}),
      ...(flags.has("force") ? { force: true } : {})
    });

    printJson({
      ok: true,
      command: "render build",
      data: {
        format: result.manifest.format,
        datasetId: result.manifest.datasetId,
        outputPath,
        fileCount: result.files.size,
        layers: result.manifest.layers
      }
    });
    return 0;
  }

  if (subcommand === "validate") {
    const [artifactPath] = args.slice(1).filter((value) => !value.startsWith("--"));

    if (!artifactPath) {
      printJson({
        ok: false,
        command: "render validate",
        issues: [createCliIssue("Render artifact path is required.")]
      });
      return 1;
    }

    const result = await validateTerritoryRenderArtifactPath(artifactPath);
    printJson({
      ok: result.ok,
      command: "render validate",
      ...(result.manifest ? { data: result.manifest } : {}),
      issues: result.issues
    });
    return result.ok ? 0 : 1;
  }

  if (subcommand === "inspect") {
    const [artifactPath] = args.slice(1).filter((value) => !value.startsWith("--"));

    if (!artifactPath) {
      printJson({
        ok: false,
        command: "render inspect",
        issues: [createCliIssue("Render artifact path is required.")]
      });
      return 1;
    }

    printJson({
      ok: true,
      command: "render inspect",
      data: await inspectTerritoryRenderArtifactPath(artifactPath)
    });
    return 0;
  }

  if (subcommand === "compare") {
    const [queryDatasetPath, renderArtifactPath] = args
      .slice(1)
      .filter((value) => !value.startsWith("--"));

    if (!queryDatasetPath || !renderArtifactPath) {
      printJson({
        ok: false,
        command: "render compare",
        issues: [createCliIssue("Query dataset path and render artifact path are required.")]
      });
      return 1;
    }

    const result = await compareTerritoryQueryRenderArtifacts({
      queryDatasetPath,
      renderArtifactPath
    });
    printJson({
      ok: result.ok,
      command: "render compare",
      issues: result.issues
    });
    return result.ok ? 0 : 1;
  }

  printJson({
    ok: false,
    command: "render",
    issues: [createCliIssue(`Unsupported render command '${subcommand}'.`)]
  });
  return 1;
}

async function runBenchmark(args: string[]): Promise<number> {
  const [subcommand] = args;

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printBenchmarkHelp();
    return 0;
  }

  if (subcommand === "run") {
    const flags = parseFlags(args.slice(1));
    const mode = getFlag(flags, "mode") ?? "fixture";

    if (mode !== "fixture" && mode !== "local-real") {
      printJson({
        ok: false,
        command: "benchmark run",
        issues: [createCliIssue("--mode must be fixture or local-real.")]
      });
      return 2;
    }

    const datasetPath = getFlag(flags, "dataset") ?? getPositionalArgs(args.slice(1)).find(Boolean);

    if (mode === "local-real" && !datasetPath) {
      const skipped = [
        "No local real-world dataset path was provided. Pass --dataset <dataset.json> to run this mode."
      ];
      printJson({
        ok: flags.has("allow-skip"),
        command: "benchmark run",
        data: createSkippedBenchmarkResult(flags, skipped),
        ...(flags.has("allow-skip")
          ? {}
          : { issues: skipped.map((message) => createCliIssue(message)) })
      });
      return flags.has("allow-skip") ? 0 : 2;
    }

    const result =
      mode === "fixture"
        ? createFixtureBenchmarkResult(flags)
        : createDatasetBenchmarkResult(loadTerritoryDataset(await readJson(datasetPath!)), {
            mode,
            scenario: getFlag(flags, "scenario") ?? "smoke",
            generatedAt: getBenchmarkGeneratedAt(flags),
            iterations: getPositiveIntegerFlag(flags, "iterations", 5_000),
            source: {
              type: "local-real",
              datasetPath
            }
          });

    printJson({
      ok: true,
      command: "benchmark run",
      data: result
    });
    return 0;
  }

  if (subcommand === "compare") {
    const flags = parseFlags(args.slice(1));
    const positional = getPositionalArgs(args.slice(1));
    const baselinePath = getFlag(flags, "baseline") ?? positional[0];
    const currentPath = getFlag(flags, "current") ?? positional[1];

    if (!baselinePath || !currentPath) {
      printJson({
        ok: false,
        command: "benchmark compare",
        issues: [createCliIssue("--baseline and --current are required.")]
      });
      return 2;
    }

    const comparison = compareCliBenchmarkResult(
      await readJson(currentPath),
      await readJson(baselinePath)
    );

    printJson({
      ok: comparison.ok,
      command: "benchmark compare",
      data: comparison
    });
    return comparison.ok ? 0 : 1;
  }

  printJson({
    ok: false,
    command: "benchmark",
    issues: [createCliIssue(`Unsupported benchmark command '${subcommand}'.`)]
  });
  return 2;
}

async function runRegistry(args: string[]): Promise<number> {
  const [subcommand] = args;

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printRegistryHelp();
    return 0;
  }

  if (subcommand === "build") {
    const flags = parseFlags(args.slice(1));
    const inputPath = getFlag(flags, "input");
    const outputPath = getFlag(flags, "output");
    const baseUrl = getFlag(flags, "base-url");

    if (!inputPath || !outputPath || !baseUrl) {
      printJson({
        ok: false,
        command: "registry build",
        issues: [createCliIssue("--input, --output, and --base-url are required.")]
      });
      return 1;
    }

    const generatedAt =
      getFlag(flags, "build-date") ??
      (process.env.SOURCE_DATE_EPOCH
        ? new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString()
        : new Date(0).toISOString());
    const registry = await buildTerritoryDatasetRegistryFromArtifacts({
      inputPath,
      baseUrl,
      generatedAt
    });
    await writeJsonOutput(outputPath, registry, flags.has("force"));
    printJson({
      ok: true,
      command: "registry build",
      data: {
        outputPath,
        datasetCount: registry.datasets.length,
        artifactCount: registry.datasets.reduce((sum, dataset) => sum + dataset.artifacts.length, 0)
      }
    });
    return 0;
  }

  if (subcommand === "validate") {
    const [registryPath] = args.slice(1).filter((value) => !value.startsWith("--"));

    if (!registryPath) {
      printJson({
        ok: false,
        command: "registry validate",
        issues: [createCliIssue("Registry path is required.")]
      });
      return 1;
    }

    const input = JSON.parse(await readFile(registryPath, "utf8")) as unknown;
    const validation = validateTerritoryDatasetRegistry(input);
    printJson({
      ok: validation.ok,
      command: "registry validate",
      ...(validation.ok
        ? { data: { datasetCount: validation.registry?.datasets.length ?? 0 } }
        : {}),
      issues: validation.issues
    });
    return validation.ok ? 0 : 1;
  }

  if (subcommand === "publish") {
    const flags = parseFlags(args.slice(1));
    const artifactRoot = getFlag(flags, "artifact-root") ?? getFlag(flags, "input");
    const registryOutput = getFlag(flags, "registry-output") ?? getFlag(flags, "output");
    const datasetId = getFlag(flags, "dataset");
    const version = getFlag(flags, "version");
    const baseUrl = getFlag(flags, "base-url");
    const targetKind = getFlag(flags, "target") ?? "local";

    if (!artifactRoot || !registryOutput || !datasetId || !version || !baseUrl) {
      printJson({
        ok: false,
        command: "registry publish",
        issues: [
          createCliIssue(
            "--artifact-root, --registry-output, --dataset, --version, and --base-url are required."
          )
        ]
      });
      return 2;
    }

    if (targetKind !== "local") {
      printJson({
        ok: false,
        command: "registry publish",
        issues: [
          createCliIssue(
            "The CLI currently publishes to --target local. Use @territory-kit/registry/node adapters for S3-compatible object storage integration."
          )
        ]
      });
      return 2;
    }

    const alias = flags.has("no-alias") ? false : (getFlag(flags, "alias") ?? "latest");
    const publicBaseUrl = getFlag(flags, "public-base-url");
    const artifactPrefix = getFlag(flags, "artifact-prefix");
    const registryKey = getFlag(flags, "registry-key");
    const immutableRegistryKey = getFlag(flags, "immutable-registry-key");
    const inventoryKey = getFlag(flags, "inventory-key");
    const rollbackKey = getFlag(flags, "rollback-key");
    const smokeRegistryUrl = getFlag(flags, "smoke-registry-url");
    const buildDate = getCliBuildDate(flags);
    const target = createLocalTerritoryRegistryPublishTarget({
      rootDir: registryOutput,
      ...(publicBaseUrl ? { publicBaseUrl } : {})
    });
    const result = await publishTerritoryDatasetRegistry({
      artifactRoot,
      target,
      datasetId,
      version,
      baseUrl,
      alias,
      generatedAt: buildDate,
      publishedAt: buildDate,
      provenance: createCliPublishProvenance(flags, artifactRoot),
      ...(artifactPrefix ? { artifactKeyPrefix: artifactPrefix } : {}),
      ...(registryKey ? { registryKey } : {}),
      ...(immutableRegistryKey ? { immutableRegistryKey } : {}),
      ...(inventoryKey ? { inventoryKey } : {}),
      ...(rollbackKey ? { rollbackKey } : {}),
      ...(flags.has("allow-overwrite") ? { allowOverwrite: true } : {}),
      ...(flags.has("dry-run") ? { dryRun: true } : {}),
      ...(flags.has("smoke-test") ? { smokeTest: true } : {}),
      ...(smokeRegistryUrl ? { smokeRegistryUrl } : {})
    });

    printJson({
      ok: true,
      command: "registry publish",
      data: {
        dryRun: result.dryRun,
        registryOutput,
        datasetId: result.datasetId,
        version: result.version,
        alias: result.alias,
        registryKey: result.registryKey,
        immutableRegistryKey: result.immutableRegistryKey,
        inventoryKey: result.inventoryKey,
        rollbackKey: result.rollbackKey,
        artifactKeyPrefix: result.artifactKeyPrefix,
        artifactCount: result.artifactCount,
        totalSizeBytes: result.totalSizeBytes,
        uploadedKeys: result.uploadedKeys,
        ...(result.smokeTest
          ? {
              smokeTest: {
                ok: result.smokeTest.ok,
                checkedArtifactCount: result.smokeTest.checkedArtifactCount,
                checkedBytes: result.smokeTest.checkedBytes
              }
            }
          : {})
      }
    });
    return 0;
  }

  if (subcommand === "verify") {
    const flags = parseFlags(args.slice(1));
    const registryUrl =
      getFlag(flags, "registry") ?? args.slice(1).find((value) => !value.startsWith("--"));

    if (!registryUrl) {
      printJson({
        ok: false,
        command: "registry verify",
        issues: [createCliIssue("--registry is required.")]
      });
      return 2;
    }

    const datasetId = getFlag(flags, "dataset");
    const version = getFlag(flags, "version");
    const result = await verifyTerritoryRegistryPublication({
      registryUrl,
      ...(datasetId ? { datasetId } : {}),
      ...(version ? { version } : {}),
      ...(flags.has("verify-content-type") ? { verifyContentType: true } : {}),
      ...(flags.has("verify-etags") ? { verifyEtags: true } : {})
    });

    printJson({
      ok: result.ok,
      command: "registry verify",
      data: {
        registryUrl: result.registryUrl,
        registryHash: result.registryHash,
        datasetCount: result.datasetCount,
        checkedArtifactCount: result.checkedArtifactCount,
        checkedBytes: result.checkedBytes
      },
      issues: result.issues
    });
    return result.ok ? 0 : 1;
  }

  if (subcommand === "inspect" || subcommand === "list") {
    const flags = parseFlags(args.slice(1));
    const registryPath =
      getFlag(flags, "registry") ?? args.slice(1).find((value) => !value.startsWith("--"));

    if (!registryPath) {
      printJson({
        ok: false,
        command: `registry ${subcommand}`,
        issues: [createCliIssue("--registry is required.")]
      });
      return 1;
    }

    const registry = await readRegistryFile(registryPath);
    printJson({
      ok: true,
      command: `registry ${subcommand}`,
      data: {
        registryVersion: registry.registryVersion,
        generatedAt: registry.generatedAt,
        baseUrl: registry.baseUrl,
        datasets: registry.datasets.map((dataset) => ({
          id: dataset.id,
          version: dataset.version,
          displayName: dataset.displayName,
          levels: dataset.levels,
          artifactCount: dataset.artifacts.length
        }))
      }
    });
    return 0;
  }

  printJson({
    ok: false,
    command: "registry",
    issues: [createCliIssue(`Unsupported registry command '${subcommand}'.`)]
  });
  return 1;
}

async function runDatasetSearch(args: string[]): Promise<number> {
  const flags = parseFlags(args);
  const query = args.find((value) => !value.startsWith("--")) ?? "";
  const client = createCliRegistryClient(flags);
  const datasets = query ? await client.searchDatasets(query) : await client.listDatasets();

  printJson({
    ok: true,
    command: "dataset search",
    data: datasets.map((dataset) => ({
      id: dataset.id,
      version: dataset.version,
      displayName: dataset.displayName,
      levels: dataset.levels
    }))
  });
  return 0;
}

async function runDatasetInfo(args: string[]): Promise<number> {
  const flags = parseFlags(args);
  const datasetId = args.find((value) => !value.startsWith("--"));

  if (!datasetId) {
    printJson({
      ok: false,
      command: "dataset info",
      issues: [createCliIssue("Dataset id is required.")]
    });
    return 1;
  }

  const client = createCliRegistryClient(flags);
  const dataset = await client.getDatasetInfo(datasetId, getFlag(flags, "version"));
  printJson({
    ok: true,
    command: "dataset info",
    data: dataset
  });
  return 0;
}

async function runDatasetResolve(args: string[]): Promise<number> {
  const flags = parseFlags(args);
  const country = getFlag(flags, "country");
  const level = readAdminLevelFlag(flags, "level");

  if (!country || isCliIssueArray(level)) {
    printJson({
      ok: false,
      command: "dataset resolve",
      issues: [
        ...(!country ? [createCliIssue("--country is required.")] : []),
        ...(isCliIssueArray(level) ? level : [])
      ]
    });
    return 2;
  }

  const client = createCliRegistryClient(flags);
  const purpose = getFlag(flags, "purpose") ?? "render";
  const formatPreference = getFlag(flags, "format-preference")
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const result = flags.has("deepest-available")
    ? await client.resolveDeepestAvailableTerritoryArtifact({
        country,
        requestedLevel: level,
        purpose: purpose as "query" | "render" | "metadata" | "adjacency" | "debug",
        fallback: "deepest-available",
        ...(formatPreference
          ? { formatPreference: formatPreference as Array<"mvt" | "geojson"> }
          : {})
      })
    : await client.resolveTerritoryArtifact({
        country,
        level,
        purpose: purpose as "query" | "render" | "metadata" | "adjacency" | "debug",
        ...(formatPreference
          ? { formatPreference: formatPreference as Array<"mvt" | "geojson"> }
          : {})
      });

  printJson({
    ok: true,
    command: "dataset resolve",
    data: result
  });
  return 0;
}

async function runDatasetInstall(
  args: string[],
  options: { update?: boolean } = {}
): Promise<number> {
  const flags = parseFlags(args);
  const datasetId = args.find((value) => !value.startsWith("--"));

  if (!datasetId) {
    printJson({
      ok: false,
      command: options.update ? "dataset update" : "dataset install",
      issues: [createCliIssue("Dataset id is required.")]
    });
    return 1;
  }

  const client = createCliRegistryClient(flags);
  const levels = parseLevelsFlag(getFlag(flags, "levels"));
  const detail = getFlag(flags, "detail");
  const version = getFlag(flags, "version");
  const handle = await client.installDataset({
    datasetId,
    ...(levels ? { levels } : {}),
    ...(detail ? { detail } : {}),
    ...(version ? { version } : {}),
    ...(flags.has("allow-prerelease") ? { allowPrerelease: true } : {}),
    ...(flags.has("load-adjacency") ? { loadAdjacency: true } : {}),
    ...(flags.has("refresh-registry") || flags.has("refresh") ? { refreshRegistry: true } : {}),
    ...(flags.has("remove-old") ? { removeOld: true } : {})
  });

  printJson({
    ok: true,
    command: options.update ? "dataset update" : "dataset install",
    data: handle.manifest
  });
  return 0;
}

async function runDatasetVerify(args: string[]): Promise<number> {
  const flags = parseFlags(args);
  const datasetId = args.find((value) => !value.startsWith("--"));

  if (!datasetId) {
    printJson({
      ok: false,
      command: "dataset verify",
      issues: [createCliIssue("Dataset id is required.")]
    });
    return 1;
  }

  const summary = await createCliRegistryClient(flags).verifyInstalledDataset(
    datasetId,
    getFlag(flags, "version")
  );
  printJson({ ok: true, command: "dataset verify", data: summary });
  return 0;
}

async function runDatasetRemove(args: string[]): Promise<number> {
  const flags = parseFlags(args);
  const datasetId = args.find((value) => !value.startsWith("--"));

  if (!datasetId) {
    printJson({
      ok: false,
      command: "dataset remove",
      issues: [createCliIssue("Dataset id is required.")]
    });
    return 1;
  }

  await createCliRegistryClient(flags).removeInstalledDataset(datasetId, getFlag(flags, "version"));
  printJson({ ok: true, command: "dataset remove", data: { datasetId } });
  return 0;
}

async function runDatasetListInstalled(args: string[]): Promise<number> {
  const flags = parseFlags(args);
  const data = await createCliRegistryClient(flags).listInstalledDatasets();
  printJson({ ok: true, command: "dataset list-installed", data });
  return 0;
}

async function runCache(args: string[]): Promise<number> {
  const [subcommand] = args;
  const flags = parseFlags(args.slice(1));
  const cacheDir = getFlag(flags, "cache-dir");
  const cache = createNodeTerritoryRegistryCache({
    ...(cacheDir ? { rootDir: cacheDir } : {})
  });

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printCacheHelp();
    return 0;
  }

  if (subcommand === "list" || subcommand === "verify") {
    const data = await cache.listInstalledDatasets();
    printJson({ ok: true, command: `cache ${subcommand}`, data });
    return 0;
  }

  if (subcommand === "clear") {
    if (!flags.has("force")) {
      printJson({
        ok: false,
        command: "cache clear",
        issues: [createCliIssue("--force is required to clear the cache.")]
      });
      return 1;
    }

    await cache.clear?.();
    printJson({ ok: true, command: "cache clear", data: { cleared: true } });
    return 0;
  }

  printJson({
    ok: false,
    command: "cache",
    issues: [createCliIssue(`Unsupported cache command '${subcommand}'.`)]
  });
  return 1;
}

async function runSource(args: string[]): Promise<number> {
  const [subcommand, sourceId] = args;
  const flags = parseFlags(subcommand === "info" ? args.slice(2) : args.slice(1));
  const json = flags.has("json");

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printSourceHelp();
    return 0;
  }

  if (subcommand === "list") {
    const adapters = listTerritorySourceAdapters();

    if (json) {
      printJson({
        ok: true,
        command: "source list",
        data: adapters.map((adapter) => adapter.describe())
      });
    } else {
      console.log(
        adapters
          .map((adapter) => {
            const description = adapter.describe();
            return [
              description.id.padEnd(16),
              formatAdminLevels(description).padEnd(16),
              description.supportedTransports.join(", ")
            ].join("  ");
          })
          .join("\n")
      );
    }

    return 0;
  }

  if (subcommand === "info" || subcommand === "inspect") {
    const inspectedSourceId =
      subcommand === "inspect" ? (getFlag(flags, "provider") ?? sourceId) : sourceId;

    if (!inspectedSourceId || inspectedSourceId === "--help" || inspectedSourceId === "-h") {
      printSourceInfoHelp();
      return inspectedSourceId ? 0 : 1;
    }

    try {
      const description = getTerritorySourceAdapter(inspectedSourceId).describe();
      const countryFlag = getFlag(flags, "country");
      const levelFlag = getFlag(flags, "level");
      const inspectRequest = {
        ...(countryFlag ? { country: countryFlag } : {}),
        ...(levelFlag ? { level: levelFlag } : {})
      };
      const capabilities =
        subcommand === "inspect"
          ? inspectTerritorySourceCapabilities({
              registry: {
                get: getTerritorySourceAdapter,
                list: listTerritorySourceAdapters,
                has: hasTerritorySourceAdapter
              },
              provider: inspectedSourceId,
              ...(countryFlag ? { country: countryFlag } : {}),
              ...(levelFlag ? { level: levelFlag } : {})
            })
          : undefined;

      if (json) {
        printJson({
          ok: true,
          command: subcommand === "inspect" ? "sources inspect" : "source info",
          data: {
            ...description,
            ...(Object.keys(inspectRequest).length > 0 ? { request: inspectRequest } : {}),
            ...(capabilities ? { capabilities } : {})
          }
        });
      } else {
        console.log(formatSourceDescription(description));
        if (Object.keys(inspectRequest).length > 0) {
          console.log(`Request: ${JSON.stringify(inspectRequest)}`);
        }
        if (capabilities) {
          console.log(formatSourceCapabilities(capabilities));
        }
      }

      return 0;
    } catch (error) {
      printJson({
        ok: false,
        command: subcommand === "inspect" ? "sources inspect" : "source info",
        issues: [
          createCliIssue(error instanceof Error ? error.message : String(error), {
            code: "SOURCE_ADAPTER_NOT_FOUND"
          })
        ]
      });
      return 1;
    }
  }

  printJson({
    ok: false,
    command: "source",
    issues: [createCliIssue(`Unsupported source command '${subcommand}'.`)]
  });
  return 1;
}

async function runImportCommand(args: string[]): Promise<number> {
  const [first] = args;

  if (!first || first === "--help" || first === "-h") {
    printImportHelp();
    return 0;
  }

  const flags = parseFlags(args.slice(1));

  if (hasTerritorySourceAdapter(first)) {
    return runSourceImport(first, flags);
  }

  if (looksLikeSourceImport(flags)) {
    printJson({
      ok: false,
      command: "import",
      issues: [
        createCliIssue(`Unknown source adapter '${first}'.`, {
          code: "SOURCE_ADAPTER_NOT_FOUND"
        })
      ]
    });
    return 1;
  }

  return runImport(first, flags);
}

async function runSourceImport(
  sourceId: string,
  flags: Map<string, string | true>
): Promise<number> {
  const outputPath = getFlag(flags, "output");

  if (!outputPath) {
    printJson({
      ok: false,
      command: `import ${sourceId}`,
      issues: [createCliIssue("--output is required for source imports.")]
    });
    return 1;
  }

  const request = createSourceRequest(flags);

  if (!request.input && !request.url) {
    printJson({
      ok: false,
      command: `import ${sourceId}`,
      issues: [createCliIssue("--input or --url is required for source imports.")]
    });
    return 1;
  }

  if (request.input && request.url) {
    printJson({
      ok: false,
      command: `import ${sourceId}`,
      issues: [createCliIssue("Use either --input or --url, not both.")]
    });
    return 1;
  }

  const buildDate = getFlag(flags, "build-date");
  const cacheDir = getFlag(flags, "cache-dir");
  const commonPipelineOptions = {
    outputPath,
    ...(flags.has("force") ? { force: true } : {}),
    ...(flags.has("strict") ? { strict: true } : {}),
    ...(flags.has("no-cache") ? { noCache: true } : {}),
    ...(cacheDir ? { cache: { enabled: true, directory: cacheDir } } : {}),
    ...(buildDate ? { now: () => new Date(buildDate).toISOString() } : {})
  };

  let result: TerritorySourcePipelineResult;

  try {
    if (sourceId === "natural-earth") {
      const detail = getFlag(flags, "detail");
      const details = detail ? readDetailFlags(detail) : undefined;

      if (detail && !details) {
        printJson({
          ok: false,
          command: "import natural-earth",
          issues: [createCliIssue(`Invalid --detail '${detail}'. Expected low, medium, or high.`)]
        });
        return 1;
      }

      const datasetVersion = getFlag(flags, "dataset-version");
      const sourceDate = getFlag(flags, "source-date");
      const sourceUrl = getFlag(flags, "source-url");
      const sourceVersion = getFlag(flags, "source-version");
      result = await runTerritorySourcePipeline<NaturalEarthSourceOptions>({
        adapter: sourceId,
        request,
        options: {
          ...(buildDate ? { buildDate: new Date(buildDate).toISOString() } : {}),
          ...(details ? { details } : {}),
          ...(datasetVersion ? { datasetVersion } : {}),
          ...(sourceDate ? { sourceDate } : {}),
          ...(sourceUrl ? { sourceUrl } : {}),
          ...(sourceVersion ? { sourceVersion } : {})
        },
        ...commonPipelineOptions
      });
    } else if (sourceId === "geoboundaries") {
      const options = readGeoBoundariesOptions(flags);

      if (Array.isArray(options)) {
        printJson({ ok: false, command: "import geoboundaries", issues: options });
        return 1;
      }

      result = await runTerritorySourcePipeline<GeoBoundariesSourceOptions>({
        adapter: sourceId,
        request,
        options,
        ...commonPipelineOptions
      });
    } else if (sourceId === "hdx-cod-ab") {
      const options = readHdxCodAbOptions(flags);

      if (Array.isArray(options)) {
        printJson({ ok: false, command: "import hdx-cod-ab", issues: options });
        return 1;
      }

      result = await runTerritorySourcePipeline<HdxCodAbSourceOptions>({
        adapter: sourceId,
        request,
        options,
        ...commonPipelineOptions
      });
    } else if (sourceId === "geojson") {
      const options = readGenericGeoJsonOptions(flags);

      if (Array.isArray(options)) {
        printJson({ ok: false, command: "import geojson", issues: options });
        return 1;
      }

      result = await runTerritorySourcePipeline<GenericGeoJsonSourceOptions>({
        adapter: sourceId,
        request,
        options,
        ...commonPipelineOptions
      });
    } else {
      printJson({
        ok: false,
        command: `import ${sourceId}`,
        issues: [
          createCliIssue(`Unknown source adapter '${sourceId}'.`, {
            code: "SOURCE_ADAPTER_NOT_FOUND"
          })
        ]
      });
      return 1;
    }
  } catch (error) {
    printJson({
      ok: false,
      command: `import ${sourceId}`,
      issues: [createCliIssue(error instanceof Error ? error.message : String(error))]
    });
    return 1;
  }

  let adjacencyOutputPath: string | undefined;

  if (result.ok && flags.has("build-adjacency")) {
    const outputBasePath = result.output?.outputPath;

    if (!outputBasePath) {
      printJson({
        ok: false,
        command: `import ${sourceId}`,
        issues: [createCliIssue("Source import did not expose an output path for adjacency build.")]
      });
      return 1;
    }

    try {
      const adjacencyOverridesPath = getFlag(flags, "adjacency-overrides");
      adjacencyOutputPath = join(outputBasePath, "adjacency");
      await buildTerritoryAdjacencyPath(outputBasePath, {
        outputPath: adjacencyOutputPath,
        includePointTouches: flags.has("adjacency-include-point-touches"),
        minimumSharedBoundaryMeters: getNumberFlag(
          flags,
          "adjacency-minimum-shared-boundary-meters",
          0
        ),
        ...(adjacencyOverridesPath ? { overridesPath: adjacencyOverridesPath } : {}),
        ...(buildDate ? { buildDate } : {}),
        ...(flags.has("strict") ? { strict: true } : {}),
        ...(flags.has("force") ? { force: true } : {})
      });
    } catch (error) {
      printJson({
        ok: false,
        command: `import ${sourceId}`,
        issues: [createCliIssue(error instanceof Error ? error.message : String(error))]
      });
      return 1;
    }
  }

  printJson({
    ok: result.ok,
    command: `import ${sourceId}`,
    ...(result.ok
      ? {
          data: {
            provider: result.provider,
            outputPath: result.output?.outputPath,
            adjacencyOutputPath,
            datasetId: result.transform?.dataset.manifest.datasetId,
            zoneCount: result.transform?.dataset.zones.length,
            cacheHit: result.artifact?.cacheHit ?? false,
            stages: result.events.map((event) => `${event.stage}:${event.status}`)
          },
          issues: result.issues
        }
      : { issues: normalizeSourceIssues(result.issues) })
  });
  return result.ok ? 0 : 1;
}

async function readJson(filePath: string): Promise<unknown> {
  const content = await readFile(filePath, "utf8");
  return JSON.parse(content) as unknown;
}

async function readBinary(filePath: string): Promise<Uint8Array> {
  return readFile(filePath);
}

function createFixtureBenchmarkResult(flags: Map<string, string | true>): CliBenchmarkResult {
  const rows = getPositiveIntegerFlag(flags, "rows", 50);
  const columns = getPositiveIntegerFlag(flags, "columns", 50);
  const cellSize = getPositiveNumberFlag(flags, "cell-size", 0.01);
  const dataset = createSyntheticGridDataset({
    datasetId: getFlag(flags, "dataset-id") ?? "territorykit-fixture-benchmark",
    rows,
    columns,
    cellSize
  });

  return createDatasetBenchmarkResult(dataset, {
    mode: "fixture",
    scenario: getFlag(flags, "scenario") ?? "smoke",
    generatedAt: getBenchmarkGeneratedAt(flags),
    iterations: getPositiveIntegerFlag(flags, "iterations", 5_000),
    source: {
      type: "synthetic-grid",
      rows,
      columns,
      cellSize
    }
  });
}

function createDatasetBenchmarkResult(
  dataset: TerritoryDataset,
  options: {
    mode: "fixture" | "local-real";
    scenario: string;
    generatedAt: string;
    iterations: number;
    source: Record<string, unknown>;
  }
): CliBenchmarkResult {
  const validation = measureOnce(() => loadTerritoryDataset(dataset));
  const engineConstruction = measureOnce(() => createTerritoryEngine({ dataset }));
  const engine = engineConstruction.value;
  const lookupZone = dataset.zones[Math.floor(dataset.zones.length / 2)];

  if (!lookupZone) {
    throw new Error("Benchmark dataset must contain at least one zone.");
  }

  const [lng, lat] = lookupZone.center;
  const bbox = lookupZone.bbox;
  const bounds = {
    west: Math.max(-180, bbox[0] - 0.01),
    south: Math.max(-90, bbox[1] - 0.01),
    east: Math.min(180, bbox[2] + 0.01),
    north: Math.min(90, bbox[3] + 0.01),
    level: lookupZone.level
  };
  const getZoneById = measureRepeated(options.iterations, () => engine.getZoneById(lookupZone.id));
  const latLngToZone = measureRepeated(options.iterations, () =>
    engine.latLngToZone({ lat, lng }, { level: lookupZone.level })
  );
  const getZonesInBounds = measureRepeated(options.iterations, () =>
    engine.getZonesInBounds(bounds)
  );

  return {
    schemaVersion: "territorykit-benchmark-result@1",
    mode: options.mode,
    scenario: options.scenario,
    generatedAt: options.generatedAt,
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch
    },
    source: options.source,
    inputs: {
      datasetId: dataset.manifest.datasetId,
      datasetVersion: dataset.manifest.datasetVersion,
      featureCount: dataset.zones.length,
      iterations: options.iterations
    },
    metrics: {
      datasetValidationMs: roundMetric(validation.durationMs),
      engineConstructionMs: roundMetric(engineConstruction.durationMs),
      getZoneByIdMeanMs: roundMetric(getZoneById.meanMs),
      latLngToZoneMeanMs: roundMetric(latLngToZone.meanMs),
      getZonesInBoundsMeanMs: roundMetric(getZonesInBounds.meanMs)
    }
  };
}

function createSkippedBenchmarkResult(
  flags: Map<string, string | true>,
  skipped: string[]
): CliBenchmarkResult {
  return {
    schemaVersion: "territorykit-benchmark-result@1",
    mode: "local-real",
    scenario: getFlag(flags, "scenario") ?? "smoke",
    generatedAt: getBenchmarkGeneratedAt(flags),
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch
    },
    source: {
      type: "local-real"
    },
    inputs: {
      featureCount: 0
    },
    metrics: {},
    skipped
  };
}

function compareCliBenchmarkResult(
  current: unknown,
  baseline: unknown
): {
  ok: boolean;
  issues: string[];
} {
  const issues: string[] = [];

  if (!isRecordValue(current) || current.schemaVersion !== "territorykit-benchmark-result@1") {
    issues.push("Current benchmark result must use territorykit-benchmark-result@1.");
  }

  if (!isRecordValue(baseline) || baseline.schemaVersion !== "territorykit-benchmark-baseline@1") {
    issues.push("Benchmark baseline must use territorykit-benchmark-baseline@1.");
  }

  if (issues.length > 0 || !isRecordValue(current) || !isRecordValue(baseline)) {
    return { ok: false, issues };
  }

  if (typeof baseline.mode === "string" && current.mode !== baseline.mode) {
    issues.push(`Expected mode '${baseline.mode}', got '${String(current.mode)}'.`);
  }

  if (typeof baseline.scenario === "string" && current.scenario !== baseline.scenario) {
    issues.push(`Expected scenario '${baseline.scenario}', got '${String(current.scenario)}'.`);
  }

  const inputs = isRecordValue(current.inputs) ? current.inputs : {};
  const featureCount = Number(inputs.featureCount ?? 0);

  if (
    typeof baseline.minimumFeatureCount === "number" &&
    featureCount < baseline.minimumFeatureCount
  ) {
    issues.push(`Expected at least ${baseline.minimumFeatureCount} features, got ${featureCount}.`);
  }

  const metrics = isRecordValue(current.metrics) ? current.metrics : {};
  const budgets = isRecordValue(baseline.budgets) ? baseline.budgets : {};

  for (const [metric, budget] of Object.entries(budgets)) {
    const maxValue = Number(budget);
    const value = Number(metrics[metric]);

    if (!Number.isFinite(maxValue)) {
      continue;
    }

    if (!Number.isFinite(value)) {
      issues.push(`Missing numeric benchmark metric '${metric}'.`);
      continue;
    }

    if (value > maxValue) {
      issues.push(`Metric '${metric}' exceeded budget ${maxValue}; got ${value}.`);
    }
  }

  return {
    ok: issues.length === 0,
    issues
  };
}

function measureOnce<T>(callback: () => T): { value: T; durationMs: number } {
  const start = performance.now();
  const value = callback();

  return {
    value,
    durationMs: performance.now() - start
  };
}

function measureRepeated(iterations: number, callback: () => unknown): { meanMs: number } {
  const start = performance.now();
  let guard = 0;

  for (let index = 0; index < iterations; index += 1) {
    const value = callback();

    if (Array.isArray(value)) {
      guard += value.length;
    } else if (value) {
      guard += 1;
    }
  }

  if (guard < 0) {
    throw new Error("Benchmark guard overflowed.");
  }

  return {
    meanMs: (performance.now() - start) / iterations
  };
}

function getBenchmarkGeneratedAt(flags: Map<string, string | true>): string {
  return getFlag(flags, "build-date") ?? new Date().toISOString();
}

function getCliBuildDate(flags: Map<string, string | true>): string {
  const buildDate = getFlag(flags, "build-date");

  if (buildDate) {
    return buildDate;
  }

  if (process.env.SOURCE_DATE_EPOCH) {
    return new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString();
  }

  return new Date().toISOString();
}

function createCliPublishProvenance(
  flags: Map<string, string | true>,
  artifactRoot: string
): Record<string, unknown> {
  const sourceRepository = getFlag(flags, "source-repository") ?? process.env.GITHUB_REPOSITORY;
  const sourceCommit = getFlag(flags, "source-commit") ?? process.env.GITHUB_SHA;
  const sourceBranch =
    getFlag(flags, "source-branch") ?? process.env.GITHUB_REF_NAME ?? process.env.GITHUB_HEAD_REF;
  const workflowRunId = getFlag(flags, "workflow-run-id") ?? process.env.GITHUB_RUN_ID;
  const buildId = getFlag(flags, "build-id") ?? process.env.GITHUB_RUN_ATTEMPT;

  return {
    command: "territory registry publish",
    artifactRoot,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    ...(sourceRepository ? { sourceRepository } : {}),
    ...(sourceCommit ? { sourceCommit } : {}),
    ...(sourceBranch ? { sourceBranch } : {}),
    ...(workflowRunId ? { workflowRunId } : {}),
    ...(buildId ? { buildId } : {})
  };
}

function roundMetric(value: number): number {
  return Number(value.toFixed(6));
}

function isRecordValue(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

async function readJsonSource(filePath: string): Promise<JsonSource> {
  const content = await readFile(filePath, "utf8");

  return {
    input: JSON.parse(content) as unknown,
    lineIndex: createJsonLineIndex(content)
  };
}

async function runImport(filePath: string, flags: Map<string, string | true>): Promise<number> {
  const { input, lineIndex } = await readJsonSource(filePath);
  const manifest = createManifestFromFlags(flags, "imported-territories");
  const importOptions: TerritoryGeoJsonImportOptions = {
    manifest,
    sourcePath: filePath
  };
  const idProperty = getFlag(flags, "id-property");
  const levelProperty = getFlag(flags, "level-property");
  const parentIdProperty = getFlag(flags, "parent-id-property");
  const childIdsProperty = getFlag(flags, "child-ids-property");
  const neighborIdsProperty = getFlag(flags, "neighbor-ids-property");

  if (idProperty) {
    importOptions.idProperty = idProperty;
  }

  if (levelProperty) {
    importOptions.levelProperty = levelProperty;
  }

  if (parentIdProperty) {
    importOptions.parentIdProperty = parentIdProperty;
  }

  if (childIdsProperty) {
    importOptions.childIdsProperty = childIdsProperty;
  }

  if (neighborIdsProperty) {
    importOptions.neighborIdsProperty = neighborIdsProperty;
  }

  const result = createTerritoryDatasetFromGeoJson(input, importOptions);
  const dataset = result.dataset ? withDeterministicGeometryHash(result.dataset) : undefined;

  printJson({
    ok: result.ok,
    command: "import",
    ...(result.ok ? { data: dataset } : { issues: withSourceLines(result.issues, lineIndex) })
  });
  return result.ok ? 0 : 1;
}

function withSourceLines(
  issues: TerritoryValidationIssue[],
  lineIndex: JsonLineIndex
): TerritoryValidationIssue[] {
  return issues.map((issue) => {
    if (issue.line !== undefined) {
      return issue;
    }

    const line = lineIndex.findLineForIssue(issue);

    return line === undefined ? issue : { ...issue, line };
  });
}

function createJsonLineIndex(content: string): JsonLineIndex {
  const lines = content.split(/\r?\n/);

  return {
    findLineForIssue(issue) {
      if (issue.featureId) {
        const featureIdLine = findFeatureIdLine(lines, issue.featureId);

        if (featureIdLine !== undefined) {
          return featureIdLine;
        }
      }

      return findFeaturePathLine(lines, issue.path);
    }
  };
}

function findFeatureIdLine(lines: string[], featureId: string): number | undefined {
  const serializedFeatureId = JSON.stringify(featureId);

  for (const [index, line] of lines.entries()) {
    if (/"id"\s*:/.test(line) && line.includes(serializedFeatureId)) {
      return index + 1;
    }
  }

  return undefined;
}

function findFeaturePathLine(lines: string[], path: string): number | undefined {
  const match = /^\$\.features\[(\d+)\]/.exec(path);

  if (!match) {
    return undefined;
  }

  const targetFeatureIndex = Number(match[1]);
  let currentFeatureIndex = -1;

  for (const [index, line] of lines.entries()) {
    if (/"type"\s*:\s*"Feature"/.test(line)) {
      currentFeatureIndex += 1;
    }

    if (currentFeatureIndex === targetFeatureIndex) {
      return index + 1;
    }
  }

  return undefined;
}

function runGenerate(args: string[]): number {
  const flags = parseFlags(args);
  const kind = getFlag(flags, "kind") ?? "grid";
  const datasetId = getFlag(flags, "dataset-id") ?? "generated-territories";

  if (kind === "grid") {
    const gridOptions = {
      datasetId,
      rows: getPositiveIntegerFlag(flags, "rows", 10),
      columns: getPositiveIntegerFlag(flags, "columns", 10),
      cellSize: getPositiveNumberFlag(flags, "cell-size", 0.01),
      level: getNonNegativeIntegerFlag(flags, "level", 0)
    };
    const datasetVersion = getFlag(flags, "dataset-version");
    const sourceDate = getFlag(flags, "source-date");

    const dataset = createSyntheticGridDataset({
      ...gridOptions,
      ...(datasetVersion ? { datasetVersion } : {}),
      ...(sourceDate ? { sourceDate } : {})
    });

    printJson({ ok: true, command: "generate", data: dataset });
    return 0;
  }

  if (kind === "voronoi" || kind === "weighted-voronoi") {
    const seeds = parseSeeds(getFlag(flags, "seeds"));
    const datasetVersion = getFlag(flags, "dataset-version");
    const sourceDate = getFlag(flags, "source-date");
    const dataset = createWeightedVoronoiDataset({
      datasetId,
      seeds,
      bounds: readBounds(flags),
      level: getNonNegativeIntegerFlag(flags, "level", 0),
      ...(datasetVersion ? { datasetVersion } : {}),
      ...(sourceDate ? { sourceDate } : {})
    });

    printJson({ ok: true, command: "generate", data: dataset });
    return 0;
  }

  printJson({
    ok: false,
    command: "generate",
    issues: [createCliIssue(`Unsupported generate kind '${kind}'.`)]
  });
  return 1;
}

function createManifestFromFlags(
  flags: Map<string, string | true>,
  fallbackDatasetId: string
): TerritoryDatasetManifest {
  return {
    datasetId: getFlag(flags, "dataset-id") ?? fallbackDatasetId,
    datasetVersion: getFlag(flags, "dataset-version") ?? "0.0.0-imported",
    schemaVersion: TERRITORY_SCHEMA_VERSION,
    sourceDate: getFlag(flags, "source-date") ?? "imported",
    geometryHash: getFlag(flags, "geometry-hash") ?? "import-pending",
    license: getFlag(flags, "license") ?? "Apache-2.0",
    name: getFlag(flags, "name") ?? "Imported TerritoryKit dataset"
  };
}

function withDeterministicGeometryHash(dataset: TerritoryDataset): TerritoryDataset {
  return {
    ...dataset,
    manifest: {
      ...dataset.manifest,
      geometryHash: createDatasetGeometryHash(dataset)
    }
  };
}

function createSourceRequest(flags: Map<string, string | true>): TerritorySourceRequest {
  const input = getFlag(flags, "input");
  const url = getFlag(flags, "url");
  const expectedSha256 = getFlag(flags, "source-sha256");
  const version = getFlag(flags, "source-version");

  return {
    ...(input ? { input } : {}),
    ...(url ? { url } : {}),
    ...(expectedSha256 ? { expectedSha256 } : {}),
    ...(version ? { version } : {}),
    ...(flags.has("refresh") ? { refresh: true } : {})
  };
}

function looksLikeSourceImport(flags: Map<string, string | true>): boolean {
  return [
    "input",
    "url",
    "output",
    "country",
    "admin-level",
    "source-sha256",
    "cache-dir",
    "no-cache",
    "refresh"
  ].some((flag) => flags.has(flag));
}

function readGeoBoundariesOptions(
  flags: Map<string, string | true>
): GeoBoundariesSourceOptions | CliIssue[] {
  const countryCode = getFlag(flags, "country");
  const adminLevel = getFlag(flags, "admin-level");
  const issues: CliIssue[] = [];

  if (!countryCode) {
    issues.push(createCliIssue("--country is required.", { code: "SOURCE_OPTIONS_INVALID" }));
  }

  if (!adminLevel) {
    issues.push(createCliIssue("--admin-level is required.", { code: "SOURCE_OPTIONS_INVALID" }));
  }

  if (!countryCode || !adminLevel) {
    return issues;
  }

  const buildDate = getFlag(flags, "build-date");
  const releaseType = getFlag(flags, "release-type");
  const sourceDate = getFlag(flags, "source-date");
  const sourceUrl = getFlag(flags, "source-url");
  const datasetId = getFlag(flags, "dataset-id");
  const datasetVersion = getFlag(flags, "dataset-version");
  const attribution = getFlag(flags, "attribution");

  return {
    countryCode,
    adminLevel,
    ...(releaseType ? { releaseType } : {}),
    ...(sourceDate ? { sourceDate } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(datasetId ? { datasetId } : {}),
    ...(datasetVersion ? { datasetVersion } : {}),
    ...(buildDate ? { buildDate: new Date(buildDate).toISOString() } : {}),
    ...(attribution ? { attribution } : {})
  };
}

function readHdxCodAbOptions(
  flags: Map<string, string | true>
): HdxCodAbSourceOptions | CliIssue[] {
  const countryCode = getFlag(flags, "country");
  const adminLevel = getFlag(flags, "admin-level");
  const issues: CliIssue[] = [];

  if (!countryCode) {
    issues.push(createCliIssue("--country is required.", { code: "SOURCE_OPTIONS_INVALID" }));
  }

  if (!adminLevel) {
    issues.push(createCliIssue("--admin-level is required.", { code: "SOURCE_OPTIONS_INVALID" }));
  }

  if (!countryCode || !adminLevel) {
    return issues;
  }

  const buildDate = getFlag(flags, "build-date");
  const sourceDate = getFlag(flags, "source-date");
  const sourceUrl = getFlag(flags, "source-url");
  const datasetId = getFlag(flags, "dataset-id");
  const datasetVersion = getFlag(flags, "dataset-version");
  const attribution = getFlag(flags, "attribution");

  return {
    countryCode,
    adminLevel,
    ...(sourceDate ? { sourceDate } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(datasetId ? { datasetId } : {}),
    ...(datasetVersion ? { datasetVersion } : {}),
    ...(buildDate ? { buildDate: new Date(buildDate).toISOString() } : {}),
    ...(attribution ? { attribution } : {})
  };
}

function readGenericGeoJsonOptions(
  flags: Map<string, string | true>
): GenericGeoJsonSourceOptions | CliIssue[] {
  const countryCode = getFlag(flags, "country");
  const adminLevel = getFlag(flags, "admin-level");
  const nameProperty = getFlag(flags, "name-property");
  const issues: CliIssue[] = [];

  if (!countryCode) {
    issues.push(createCliIssue("--country is required.", { code: "SOURCE_OPTIONS_INVALID" }));
  }

  if (!adminLevel) {
    issues.push(createCliIssue("--admin-level is required.", { code: "SOURCE_OPTIONS_INVALID" }));
  }

  if (!nameProperty) {
    issues.push(createCliIssue("--name-property is required.", { code: "SOURCE_OPTIONS_INVALID" }));
  }

  if (!countryCode || !adminLevel || !nameProperty) {
    return issues;
  }

  const buildDate = getFlag(flags, "build-date");
  const idProperty = getFlag(flags, "id-property");
  const sourceIdProperty = getFlag(flags, "source-id-property");
  const parentProperty = getFlag(flags, "parent-property");
  const codeProperty = getFlag(flags, "code-property");
  const localType = getFlag(flags, "local-type");
  const provider = getFlag(flags, "provider");
  const sourceUrl = getFlag(flags, "source-url");
  const sourceDate = getFlag(flags, "source-date");
  const license = getFlag(flags, "license");
  const attribution = getFlag(flags, "attribution");
  const datasetId = getFlag(flags, "dataset-id");
  const datasetVersion = getFlag(flags, "dataset-version");

  return {
    countryCode,
    adminLevel,
    nameProperty,
    ...(idProperty ? { idProperty } : {}),
    ...(sourceIdProperty ? { sourceIdProperty } : {}),
    ...(parentProperty ? { parentProperty } : {}),
    ...(codeProperty ? { codeProperty } : {}),
    ...(localType ? { localType } : {}),
    ...(provider ? { provider } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(sourceDate ? { sourceDate } : {}),
    ...(license ? { license } : {}),
    ...(attribution ? { attribution } : {}),
    ...(datasetId ? { datasetId } : {}),
    ...(datasetVersion ? { datasetVersion } : {}),
    ...(buildDate ? { buildDate: new Date(buildDate).toISOString() } : {})
  };
}

function readGeometryQualityOptions(
  flags: Map<string, string | true>
): GeometryQualityOptions | CliIssue[] {
  const issues: CliIssue[] = [];
  const checks = readGeometryChecksFlag(flags, issues);
  const backend = getFlag(flags, "backend") ?? "typescript";
  const epsilon = readOptionalNonNegativeNumberFlag(flags, "epsilon", issues);
  const batchSize = readOptionalPositiveIntegerFlag(flags, "batch-size", issues);
  const allowHoleBoundaryTouch = readOptionalBooleanFlag(
    flags,
    "allow-hole-boundary-touch",
    issues
  );

  if (backend !== "typescript") {
    issues.push(
      createCliIssue(`Geometry backend '${backend}' is not available in this CLI build.`, {
        code: "GEOMETRY_BACKEND_UNAVAILABLE"
      })
    );
  }

  if (issues.length > 0 || !checks) {
    return issues;
  }

  return {
    mode: "validate-only",
    checks,
    ...(flags.has("strict") ? { strict: true } : {}),
    ...(epsilon === undefined ? {} : { epsilon }),
    ...(batchSize === undefined ? {} : { batchSize }),
    ...(allowHoleBoundaryTouch === undefined ? {} : { allowHoleBoundaryTouch })
  };
}

function readGeometryRepairOptions(
  flags: Map<string, string | true>,
  commonOptions: GeometryQualityOptions
): (GeometryRepairOptions & { force?: boolean }) | CliIssue[] {
  const issues: CliIssue[] = [];
  const repairStrategy = (getFlag(flags, "repair-strategy") ?? "safe") as GeometryRepairStrategy;
  const maximumAreaDeltaRatio = readOptionalNonNegativeNumberFlag(
    flags,
    "maximum-area-delta-ratio",
    issues
  );
  const normalizeRingOrientation = readOptionalBooleanFlag(
    flags,
    "normalize-ring-orientation",
    issues
  );

  if (repairStrategy !== "safe" && repairStrategy !== "postgis-make-valid") {
    issues.push(
      createCliIssue(
        `Invalid --repair-strategy '${repairStrategy}'. Expected safe or postgis-make-valid.`
      )
    );
  } else if (repairStrategy === "postgis-make-valid") {
    issues.push(
      createCliIssue("Repair strategy 'postgis-make-valid' requires a PostGIS backend.", {
        code: "GEOMETRY_REPAIR_STRATEGY_UNAVAILABLE"
      })
    );
  }

  if (issues.length > 0) {
    return issues;
  }

  return {
    ...commonOptions,
    mode: "repair",
    repairStrategy: "safe",
    ...(maximumAreaDeltaRatio === undefined ? {} : { maximumAreaDeltaRatio }),
    ...(normalizeRingOrientation === undefined ? {} : { normalizeRingOrientation }),
    ...(flags.has("force") ? { force: true } : {})
  };
}

function readAdjacencyBuildOptions(
  flags: Map<string, string | true>
): (TerritoryAdjacencyBuildOptions & { buildDate?: string }) | CliIssue[] {
  const issues: CliIssue[] = [];
  const epsilon = readOptionalNonNegativeNumberFlag(flags, "epsilon", issues);
  const batchSize = readOptionalPositiveIntegerFlag(flags, "batch-size", issues);
  const minimumSharedBoundaryMeters = readOptionalNonNegativeNumberFlag(
    flags,
    "minimum-shared-boundary-meters",
    issues
  );

  if (flags.has("same-parent-only") && flags.has("all-parents")) {
    issues.push(createCliIssue("Use either --same-parent-only or --all-parents, not both."));
  }

  if (flags.has("same-admin-level-only") && flags.has("cross-level")) {
    issues.push(createCliIssue("Use either --same-admin-level-only or --cross-level, not both."));
  }

  if (issues.length > 0) {
    return issues;
  }

  return {
    sameParentOnly: !flags.has("all-parents"),
    sameAdminLevelOnly: !flags.has("cross-level"),
    includePointTouches: flags.has("include-point-touches"),
    ...(minimumSharedBoundaryMeters === undefined ? {} : { minimumSharedBoundaryMeters }),
    ...(epsilon === undefined ? {} : { epsilon }),
    ...(batchSize === undefined ? {} : { batchSize }),
    ...(flags.has("strict") ? { strict: true } : {})
  };
}

function readAdjacencyTypesFlag(
  flags: Map<string, string | true>
): TerritoryAdjacencyType[] | CliIssue[] | undefined {
  const value = getFlag(flags, "type");

  if (!value) {
    return undefined;
  }

  const types = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const validTypes = new Set(["shared-border", "point-touch", "maritime", "logical"]);
  const invalid = types.find((type) => !validTypes.has(type));

  if (invalid) {
    return [createCliIssue(`Invalid adjacency type '${invalid}'.`)];
  }

  return types as TerritoryAdjacencyType[];
}

function readSimplificationDetailsFlag(
  flags: Map<string, string | true>
): Array<"high" | "medium" | "low"> | CliIssue[] {
  const value = getFlag(flags, "detail") ?? "high,medium,low";
  const details = value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  const validDetails = new Set(["high", "medium", "low"]);
  const invalid = details.find((detail) => !validDetails.has(detail));

  if (!invalid && details.length > 0) {
    return [...new Set(details)] as Array<"high" | "medium" | "low">;
  }

  return [
    createCliIssue(
      invalid
        ? `Invalid --detail entry '${invalid}'. Expected high, medium, or low.`
        : "--detail must include at least one simplification tier."
    )
  ];
}

function readCountryLevelsFlag(
  flags: Map<string, string | true>,
  fallback?: readonly TerritoryAdminLevel[]
): TerritoryAdminLevel[] | CliIssue[] | undefined {
  const value = getFlag(flags, "levels");

  if (!value) {
    return fallback ? [...fallback] : undefined;
  }

  const levels = value
    .split(",")
    .map((entry) => entry.trim().toUpperCase())
    .filter(Boolean);
  const validLevels = new Set<TerritoryAdminLevel>(TERRITORY_ADMIN_LEVELS);
  const invalid = levels.find((level) => !validLevels.has(level as TerritoryAdminLevel));

  if (!invalid && levels.length > 0) {
    return [...new Set(levels)] as TerritoryAdminLevel[];
  }

  return [
    createCliIssue(
      invalid
        ? `Invalid --levels entry '${invalid}'. Expected ${TERRITORY_ADMIN_LEVELS.join(", ")}.`
        : "--levels must include at least one admin level."
    )
  ];
}

function readAdminLevelFlag(
  flags: Map<string, string | true>,
  name: string
): TerritoryAdminLevel | CliIssue[] {
  const value = getFlag(flags, name);

  if (!value) {
    return [createCliIssue(`--${name} is required.`)];
  }

  const level = value.trim().toUpperCase();

  if (TERRITORY_ADMIN_LEVELS.includes(level as TerritoryAdminLevel)) {
    return level as TerritoryAdminLevel;
  }

  return [
    createCliIssue(`Invalid --${name} '${value}'. Expected ${TERRITORY_ADMIN_LEVELS.join(", ")}.`)
  ];
}

function isCliIssueArray(input: unknown): input is CliIssue[] {
  return (
    Array.isArray(input) &&
    input.some(
      (entry) =>
        typeof entry === "object" && entry !== null && "severity" in entry && "message" in entry
    )
  );
}

function printAdjacencyInspection(
  zoneId: string,
  neighbors: string[],
  relations: Array<{
    from: string;
    to: string;
    type: TerritoryAdjacencyType;
    sharedBoundaryMeters?: number;
  }>
): void {
  const grouped = new Map<TerritoryAdjacencyType, string[]>();

  for (const edge of relations) {
    const neighborId = edge.from === zoneId ? edge.to : edge.from;
    const label =
      edge.sharedBoundaryMeters === undefined
        ? neighborId
        : `${neighborId} - ${Math.round(edge.sharedBoundaryMeters)} m`;
    grouped.set(edge.type, [...(grouped.get(edge.type) ?? []), label]);
  }

  console.log(`Zone: ${zoneId}`);
  console.log(`Neighbors: ${neighbors.length}`);

  for (const type of ["shared-border", "point-touch", "maritime", "logical"] as const) {
    const values = grouped.get(type)?.sort();

    if (!values || values.length === 0) {
      continue;
    }

    console.log("");
    console.log(type);

    for (const value of values) {
      console.log(`- ${value}`);
    }
  }
}

function readGeometryChecksFlag(
  flags: Map<string, string | true>,
  issues: CliIssue[]
): GeometryQualityCheckPreset | undefined {
  const checks = getFlag(flags, "checks") ?? "full";

  if (checks === "basic" || checks === "full") {
    return checks;
  }

  issues.push(createCliIssue(`Invalid --checks '${checks}'. Expected basic or full.`));
  return undefined;
}

function normalizeSourceIssues(issues: TerritorySourceIssue[]): TerritorySourceIssue[] {
  return issues.map((issue) => {
    if (issue.code !== "SOURCE_INPUT_NOT_FOUND") {
      return issue;
    }

    return {
      ...issue,
      code: "SOURCE_NOT_FOUND"
    };
  });
}

function formatAdminLevels(description: TerritorySourceDescription): string {
  const levels = [...description.supportedAdminLevels];

  if (description.id === "geojson") {
    return "configurable";
  }

  if (levels.length === TERRITORY_ADMIN_LEVELS.length) {
    return "ADM0-ADM5";
  }

  return levels.join(",");
}

function formatSourceDescription(description: TerritorySourceDescription): string {
  return [
    `Source ID: ${description.id}`,
    `Display name: ${description.displayName}`,
    `Supported admin levels: ${formatAdminLevels(description)}`,
    `Supported transports: ${description.supportedTransports.join(", ")}`,
    `Input formats: ${description.inputFormats.join(", ")}`,
    `Default license: ${description.defaultLicense ?? "not declared"}`,
    `Attribution required: ${description.attributionRequired ? "yes" : "no"}`,
    `Options: ${description.options.map((option) => option.name).join(", ") || "none"}`,
    `Example: ${description.exampleCommand}`
  ].join("\n");
}

function formatSourceCapabilities(capabilities: TerritoryProviderCapabilitiesResult): string {
  const rows = Object.values(capabilities.levels)
    .filter((level) => Boolean(level))
    .map((level) => `${level.level}: ${level.status}${level.reason ? ` (${level.reason})` : ""}`)
    .join("\n");

  return ["", "Capabilities:", rows].join("\n");
}

function formatCountryConfig(config: ReturnType<typeof getTerritoryCountryConfig>): string {
  return [
    `Country: ${config.displayName} (${config.countryCodeAlpha2}/${config.countryCodeAlpha3})`,
    `Dataset ID: ${config.datasetId}`,
    `Loader package: ${config.loaderPackageName}`,
    `Source provider: ${config.sourceProvider}`,
    `Default release: ${config.defaultReleaseType ?? "not specified"}`,
    `Requested levels: ${config.requestedLevels.join(", ")}`,
    `Adjacency levels: ${config.adjacencyPolicy.levels.join(", ") || "none"}`,
    `License policy: ${config.licensePolicy.allowedReleaseTypes.join(", ")}`
  ].join("\n");
}

function parseFlags(args: string[]): Map<string, string | true> {
  const flags = new Map<string, string | true>();

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];

    if (!value?.startsWith("--")) {
      continue;
    }

    const key = value.slice(2);
    const next = args[index + 1];

    if (!next || next.startsWith("--")) {
      flags.set(key, true);
      continue;
    }

    flags.set(key, next);
    index += 1;
  }

  return flags;
}

function getPositionalArgs(args: string[]): string[] {
  const positional: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];

    if (!value) {
      continue;
    }

    if (value.startsWith("--")) {
      const next = args[index + 1];

      if (next && !next.startsWith("--")) {
        index += 1;
      }

      continue;
    }

    positional.push(value);
  }

  return positional;
}

function getFlag(flags: Map<string, string | true>, key: string): string | undefined {
  const value = flags.get(key);
  return typeof value === "string" ? value : undefined;
}

function getNumberFlag(flags: Map<string, string | true>, key: string, fallback: number): number {
  const value = getFlag(flags, key);
  const parsed = value === undefined ? Number.NaN : Number(value);

  return Number.isFinite(parsed) ? parsed : fallback;
}

function getOptionalNumberFlag(flags: Map<string, string | true>, key: string): number | undefined {
  const value = getFlag(flags, key);

  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function createCliRegistryClient(flags: Map<string, string | true>) {
  const registryUrl = getFlag(flags, "registry");
  const cacheDir = getFlag(flags, "cache-dir");

  return createNodeTerritoryRegistryClient({
    ...(registryUrl ? { registryUrl } : {}),
    ...(cacheDir ? { cacheDir } : {}),
    ...(flags.has("offline") ? { offline: true } : {}),
    ...(flags.has("no-verify") ? { verifyChecksums: false } : {}),
    ...(flags.has("allow-http") ? { allowHttp: true } : {})
  });
}

function parseLevelsFlag(input: string | undefined): TerritoryAdminLevel[] | undefined {
  if (!input) {
    return undefined;
  }

  return input
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean)
    .map((value) => {
      if (TERRITORY_ADMIN_LEVELS.includes(value as TerritoryAdminLevel)) {
        return value as TerritoryAdminLevel;
      }

      throw new Error(
        `Invalid --levels entry '${value}'. Expected ${TERRITORY_ADMIN_LEVELS.join(", ")}.`
      );
    });
}

async function writeJsonOutput(path: string, payload: unknown, force: boolean): Promise<void> {
  if (!force) {
    try {
      await readFile(path);
      throw new Error(`Output path '${path}' already exists. Pass --force to overwrite.`);
    } catch (error) {
      if (error instanceof Error && error.message.includes("already exists")) {
        throw error;
      }
    }
  }

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function writeTextOutput(path: string, payload: string, force: boolean): Promise<void> {
  if (!force) {
    try {
      await readFile(path);
      throw new Error(`Output path '${path}' already exists. Pass --force to overwrite.`);
    } catch (error) {
      if (error instanceof Error && error.message.includes("already exists")) {
        throw error;
      }
    }
  }

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, payload.endsWith("\n") ? payload : `${payload}\n`, "utf8");
}

async function writeBinaryOutput(
  path: string,
  payload: ArrayBuffer,
  force: boolean
): Promise<void> {
  if (!force) {
    try {
      await readFile(path);
      throw new Error(`Output path '${path}' already exists. Pass --force to overwrite.`);
    } catch (error) {
      if (error instanceof Error && error.message.includes("already exists")) {
        throw error;
      }
    }
  }

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, new Uint8Array(payload));
}

function readOptionalNonNegativeNumberFlag(
  flags: Map<string, string | true>,
  key: string,
  issues: CliIssue[]
): number | undefined {
  const value = getFlag(flags, key);

  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    issues.push(createCliIssue(`--${key} must be a non-negative number.`));
    return undefined;
  }

  return parsed;
}

function readOptionalPositiveNumberFlag(
  flags: Map<string, string | true>,
  key: string,
  issues: CliIssue[]
): number | undefined {
  const value = getFlag(flags, key);

  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    issues.push(createCliIssue(`--${key} must be a positive number.`));
    return undefined;
  }

  return parsed;
}

function readOptionalPositiveIntegerFlag(
  flags: Map<string, string | true>,
  key: string,
  issues: CliIssue[]
): number | undefined {
  const value = getFlag(flags, key);

  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    issues.push(createCliIssue(`--${key} must be a positive integer.`));
    return undefined;
  }

  return parsed;
}

function readCommaSeparatedFlag(flags: Map<string, string | true>, key: string): string[] {
  const value = getFlag(flags, key);

  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readOptionalBooleanFlag(
  flags: Map<string, string | true>,
  key: string,
  issues: CliIssue[]
): boolean | undefined {
  const value = flags.get(key);

  if (value === undefined) {
    return undefined;
  }

  if (value === true) {
    return true;
  }

  if (["true", "1", "yes"].includes(value.toLowerCase())) {
    return true;
  }

  if (["false", "0", "no"].includes(value.toLowerCase())) {
    return false;
  }

  issues.push(createCliIssue(`--${key} must be true or false.`));
  return undefined;
}

function getPositiveIntegerFlag(
  flags: Map<string, string | true>,
  key: string,
  fallback: number
): number {
  const value = getNumberFlag(flags, key, fallback);

  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`--${key} must be a positive integer.`);
  }

  return value;
}

function getNonNegativeIntegerFlag(
  flags: Map<string, string | true>,
  key: string,
  fallback: number
): number {
  const value = getNumberFlag(flags, key, fallback);

  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`--${key} must be a non-negative integer.`);
  }

  return value;
}

function getPositiveNumberFlag(
  flags: Map<string, string | true>,
  key: string,
  fallback: number
): number {
  const value = getNumberFlag(flags, key, fallback);

  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`--${key} must be a positive number.`);
  }

  return value;
}

function readBounds(flags: Map<string, string | true>): {
  west: number;
  south: number;
  east: number;
  north: number;
} {
  const bounds = {
    west: getNumberFlag(flags, "west", 0),
    south: getNumberFlag(flags, "south", 0),
    east: getNumberFlag(flags, "east", 1),
    north: getNumberFlag(flags, "north", 1)
  };

  if (bounds.west >= bounds.east || bounds.south >= bounds.north) {
    throw new Error("--west/--east and --south/--north must define ordered bounds.");
  }

  return bounds;
}

function parseSeeds(
  input: string | undefined
): Array<{ id: string; lng: number; lat: number; weight?: number }> {
  if (!input) {
    return [
      { id: "seed:0", lng: 0.25, lat: 0.5, weight: 1 },
      { id: "seed:1", lng: 0.75, lat: 0.5, weight: 1 }
    ];
  }

  const parsed = JSON.parse(input) as unknown;

  if (!Array.isArray(parsed)) {
    throw new Error("--seeds must be a JSON array.");
  }

  return parsed.map((seed, index) => {
    if (
      typeof seed === "object" &&
      seed !== null &&
      "id" in seed &&
      "lng" in seed &&
      "lat" in seed
    ) {
      const record = seed as Record<string, unknown>;

      return {
        id: String(record.id),
        lng: Number(record.lng),
        lat: Number(record.lat),
        ...(record.weight === undefined ? {} : { weight: Number(record.weight) })
      };
    }

    throw new Error(`Invalid seed at index ${index}.`);
  });
}

function readDetailFlag(input: string): NaturalEarthAdm0Detail[] | undefined {
  if (NATURAL_EARTH_ADM0_DETAILS.includes(input as NaturalEarthAdm0Detail)) {
    return [input as NaturalEarthAdm0Detail];
  }

  return undefined;
}

function readDetailFlags(input: string): NaturalEarthAdm0Detail[] | undefined {
  const details = input
    .split(",")
    .map((detail) => detail.trim())
    .filter(Boolean);

  if (
    details.length > 0 &&
    details.every((detail) => NATURAL_EARTH_ADM0_DETAILS.includes(detail as NaturalEarthAdm0Detail))
  ) {
    return details as NaturalEarthAdm0Detail[];
  }

  return undefined;
}

function printDatasetCoverageSummary(input: unknown): void {
  if (!isRecordValue(input) || !isRecordValue(input.summary)) {
    console.log("Coverage registry is missing a summary.");
    return;
  }

  const totalCountries = input.summary.totalCountries;
  const levels = isRecordValue(input.summary.levels) ? input.summary.levels : {};

  console.log(`Countries: ${typeof totalCountries === "number" ? totalCountries : "unknown"}`);

  for (const [level, rawStatuses] of Object.entries(levels)) {
    if (!isRecordValue(rawStatuses)) {
      continue;
    }

    const built = Number(rawStatuses.built ?? 0);
    const packaged = Number(rawStatuses.packaged ?? 0);
    const sourceAvailable = Number(rawStatuses["source-available"] ?? 0);
    const sourceUnavailable = Number(rawStatuses["source-unavailable"] ?? 0);
    const validationFailed = Number(rawStatuses["validation-failed"] ?? 0);
    const notReviewed = Number(rawStatuses["not-reviewed"] ?? 0);
    const licenseRestricted = Number(rawStatuses["license-restricted"] ?? 0);

    console.log(
      `${level.padEnd(14)} built=${built} packaged=${packaged} source-available=${sourceAvailable} source-unavailable=${sourceUnavailable} validation-failed=${validationFailed} not-reviewed=${notReviewed} license-restricted=${licenseRestricted}`
    );
  }
}

function filterCoverageRegistryLevels(
  input: unknown,
  levels: readonly TerritoryAdminLevel[]
): unknown {
  if (!isRecordValue(input)) {
    return input;
  }

  const selected = new Set(levels);
  const summary = isRecordValue(input.summary)
    ? {
        ...input.summary,
        ...(isRecordValue(input.summary.levels)
          ? { levels: filterRecordByKeys(input.summary.levels, selected) }
          : {}),
        ...(isRecordValue(input.summary.sourceStatus)
          ? { sourceStatus: filterRecordByKeys(input.summary.sourceStatus, selected) }
          : {}),
        ...(isRecordValue(input.summary.validationStatus)
          ? { validationStatus: filterRecordByKeys(input.summary.validationStatus, selected) }
          : {}),
        ...(isRecordValue(input.summary.semanticReviewStatus)
          ? {
              semanticReviewStatus: filterRecordByKeys(input.summary.semanticReviewStatus, selected)
            }
          : {})
      }
    : input.summary;

  return {
    ...input,
    ...(Array.isArray(input.levels)
      ? { levels: input.levels.filter((level) => selected.has(level as TerritoryAdminLevel)) }
      : {}),
    ...(summary ? { summary } : {}),
    ...(Array.isArray(input.countries)
      ? {
          countries: input.countries.map((country) =>
            isRecordValue(country) && isRecordValue(country.levels)
              ? { ...country, levels: filterRecordByKeys(country.levels, selected) }
              : country
          )
        }
      : {})
  };
}

function filterRecordByKeys(
  input: Record<string, unknown>,
  keys: ReadonlySet<TerritoryAdminLevel>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([key]) => keys.has(key as TerritoryAdminLevel))
  );
}

function cliWorkspacePath(relativePath: string): string {
  return join(CLI_WORKSPACE_ROOT, relativePath);
}

function printJson(payload: unknown): void {
  console.log(JSON.stringify(payload, null, 2));
}

function createCliIssue(message: string, options: { code?: string } = {}): CliIssue {
  return {
    code: options.code ?? "CLI_USAGE",
    message,
    path: "$",
    severity: "error"
  };
}

function printHelp(): void {
  console.log(`territory <command> <dataset.json>

Commands:
  validate   Validate a TerritoryKit dataset
  registry   Build, validate, inspect, and list dataset registries
  geometry   Validate or safely repair dataset geometry
  index      Build, inspect, or validate binary spatial indexes
  adjacency  Build, validate, inspect, or legacy-infer territory adjacency
  render     Build, validate, inspect, or compare render artifacts
  benchmark  Run or compare fixture/local-real benchmark results
  country    Build and inspect configured country dataset artifacts
  import     Import a GeoJSON file or source adapter artifact
  source     List and inspect source adapters (alias: sources)
  dataset    Build curated datasets and install registry artifacts
  identity   Compare stable identity changes across dataset versions
  cache      List, verify, or clear installed dataset cache artifacts
  tr         Turkey ADM3 tools
  simplify   Emit a deterministic no-op simplification result for pipeline wiring
  generate   Generate grid or weighted-voronoi MVP datasets as JSON`);
}

function printTurkeyHelp(): void {
  console.log(`territory tr <command>

Commands:
  adm3  Turkey ADM3 tools`);
}

function printTurkeyAdm3Help(): void {
  console.log(`territory tr adm3 <command>

Commands:
  providers list
  providers health
  coverage
  source-audit
  generate
  build

Options:
  --registry <json> --fallbacks <json> --allow-experimental --allow-runtime
  --official --osm --fill-gaps --output <json>
  generate --dataset <adm2.json> --district-id <id> --profile auto --output <dir>`);
}

function printTurkeyAdm3ProvidersHelp(): void {
  console.log(`territory tr adm3 providers <command>

Commands:
  list
  health

Options:
  --class official|runtime|experimental|osm|generated
  --allow-experimental --registry <json> --output <json> --network --build-date <iso> --force`);
}

function printIndexHelp(): void {
  console.log(`territory index <command>

Commands:
  build <dataset.json> --output <index.tksi>
  inspect <index.tksi>
  validate <index.tksi> [--dataset <dataset.json>]

Compatibility:
  territory index <dataset.json> emits the legacy spatial-index metadata summary.

Options:
  --force`);
}

function printRegistryHelp(): void {
  console.log(`territory registry <command>

Commands:
  build --input <artifact-dir> --output <registry.json> --base-url <url>
  publish --artifact-root <artifact-dir> --registry-output <dir> --dataset <id> --version <semver> --base-url <url>
  verify --registry <registry.json|url> [--dataset <id>] [--version <semver>]
  validate <registry.json>
  inspect --registry <registry.json>
  list --registry <registry.json>

Options:
  --alias <name>
  --no-alias
  --artifact-prefix <object-prefix>
  --registry-key <object-key>
  --dry-run
  --allow-overwrite
  --smoke-test
  --smoke-registry-url <url>
  --verify-content-type
  --verify-etags
  --build-date <iso-date>
  --force
  --json`);
}

function printCountryHelp(): void {
  console.log(`territory country <command>

Commands:
  list                         List configured countries
  info <country>               Show country config
  source lock <country>        Resolve and lock source artifacts
  source verify <lock.json>    Re-fetch/re-read locked source artifacts
  build <country>              Build country dataset artifacts from a source lock
  validate <artifact-dir>      Validate country artifact checksums and datasets
  inspect <artifact-dir>       Summarize a built country artifact

Aliases:
  territory country source-lock <country>
  territory country source-verify <lock.json>`);
}

function printCountryInfoHelp(): void {
  console.log(`territory country info <country>

Examples:
  territory country info TR
  territory country info united-states --json`);
}

function printCountrySourceHelp(): void {
  console.log(`territory country source <command>

Commands:
  lock <country>        Resolve source metadata, verify artifacts, and write sources.lock.json
  verify <lock.json>    Verify a source lock against its recorded checksums`);
}

function printCountrySourceLockHelp(): void {
  console.log(`territory country source lock <country> --output <sources.lock.json>

Options:
  --levels ADM0,ADM1,ADM2,ADM3,ADM4,ADM5
  --release-type gbOpen
  --metadata <metadata.json>
  --metadata-url <metadata-url>
  --adm3-provinces 27,34,54
  --adm3-catalog <tr-adm3-catalog.json>
  --cache-dir <dir>
  --max-source-bytes <bytes>
  --no-cache
  --refresh
  --build-date <iso-date>
  --force
  --json`);
}

function printCountrySourceVerifyHelp(): void {
  console.log(`territory country source verify <sources.lock.json>

Options:
  --build-date <iso-date>
  --json`);
}

function printCountryBuildHelp(): void {
  console.log(`territory country build <country> --source-lock <sources.lock.json> --output <dir>

Options:
  --levels ADM0,ADM1,ADM2,ADM3,ADM4,ADM5
  --build-adjacency
  --build-query-artifacts
  --build-render-artifacts
  --build-binary-index
  --strict
  --allow-non-publish-ready
  --allow-partial
  --build-date <iso-date>
  --batch-size <integer>
  --phase-timeout-ms <ms>
  --profile
  --profile-report <path>
  --force
  --json`);
}

function printCountryValidateHelp(): void {
  console.log(`territory country validate <artifact-dir>

Options:
  --strict`);
}

function printCountryInspectHelp(): void {
  console.log("territory country inspect <artifact-dir>");
}

function printGeometryHelp(): void {
  console.log(`territory geometry <command> <dataset-path>

Commands:
  validate  Validate geometry quality for dataset.json or a dataset directory
  repair    Apply safe, audited geometry repairs and write a repaired dataset
  simplify  Build topology-safe high, medium, and low geometry tiers

Options:
  --checks basic|full
  --strict
  --backend typescript
  --epsilon <number>
  --maximum-area-delta-ratio <number>
  --allow-hole-boundary-touch true|false
  --repair-strategy safe
  --strategy topology-safe
  --detail high,medium,low
  --normalize-ring-orientation true|false
  --output <dir>
  --report <report.json>
  --force`);
}

function printAdjacencyHelp(): void {
  console.log(`territory adjacency <command>

Commands:
  build <dataset-path>                 Build polygon adjacency artifact
  validate <dataset-path> <artifact>    Validate adjacency artifact
  inspect <artifact> <zone-id>          Inspect zone neighbors

Legacy:
  territory adjacency <dataset.json>    Infer bbox adjacency helper output`);
}

function printAdjacencyBuildHelp(): void {
  console.log(`territory adjacency build <dataset-path> --output <adjacency.json|dir>

Options:
  --all-parents
  --cross-level
  --include-point-touches
  --minimum-shared-boundary-meters <number>
  --epsilon <number>
  --batch-size <integer>
  --overrides <overrides.json>
  --strict
  --report <report.json>
  --build-date <iso-date>
  --force
  --json`);
}

function printAdjacencyValidateHelp(): void {
  console.log("territory adjacency validate <dataset-path> <adjacency.json|dir>");
}

function printAdjacencyInspectHelp(): void {
  console.log(`territory adjacency inspect <adjacency.json|dir> <zone-id>

Options:
  --type shared-border|point-touch|maritime|logical
  --json`);
}

function printRenderHelp(): void {
  console.log(`territory render <command>

Commands:
  build <dataset.json> --output <dir>       Build render artifacts
  validate <artifact-dir>                   Validate render artifact structure
  inspect <artifact-dir>                    Print render manifest
  compare <dataset.json> <artifact-dir>     Compare query identity with render metadata

Options:
  --format mvt|geojson
  --layer <source-layer>
  --min-zoom <number>
  --max-zoom <number>
  --build-date <iso-date>
  --force
  --json`);
}

function printBenchmarkHelp(): void {
  console.log(`territory benchmark <command>

Commands:
  run                         Run a fixture or local-real benchmark smoke
  compare --baseline <json> --current <json>

Options:
  --mode fixture|local-real
  --dataset <dataset.json>
  --allow-skip
  --rows <number>
  --columns <number>
  --cell-size <number>
  --iterations <number>
  --build-date <iso-date>
  --json`);
}

function printSourceHelp(): void {
  console.log(`territory source <command>

Commands:
  list                        List registered source adapters
  info <source-id>            Show source adapter details
  inspect --provider <id>     Inspect a provider for a country/level request

Options:
  --country <ISO2>
  --level <ADM0|ADM1|ADM2|ADM3|ADM4|ADM5>
  --json               Emit machine-readable JSON`);
}

function printSourceInfoHelp(): void {
  console.log(`territory source info <source-id>

Examples:
  territory source info natural-earth
  territory source info geoboundaries --json
  territory sources inspect --provider geoboundaries --country TR --level ADM3 --json`);
}

function printImportHelp(): void {
  console.log(`territory import <source-id> --input <source.geojson> --output <dir>

Source adapters:
  natural-earth
  geoboundaries
  hdx-cod-ab
  geojson

Legacy:
  territory import <regions.geojson> --dataset-id imported-territories`);
}

function printDatasetHelp(): void {
  console.log(`territory dataset <command>

Commands:
  build            Build a curated TerritoryKit dataset artifact
  build-all        Attempt configured country builds and write a machine-readable report
  coverage         Print or generate global coverage lifecycle summary
  diff             Compare two dataset versions and emit Markdown/JSON/CSV reports
  migration-plan   Create a reviewed ID migration mapping between two dataset versions
  search           Search registry datasets
  info             Show registry dataset metadata
  resolve          Resolve a country/level artifact, optionally with deepest-available fallback
  install          Install dataset artifacts into the local cache
  update           Refresh or switch installed dataset artifacts
  verify           Verify an installed dataset
  remove           Remove an installed dataset
  list-installed   List installed datasets`);
}

function printIdentityHelp(): void {
  console.log(`territory identity <command>

Commands:
  diff <old-dataset.json> <new-dataset.json>   Compare identity changes only`);
}

function printDatasetDiffHelp(identityOnly: boolean): void {
  console.log(`${identityOnly ? "territory identity diff" : "territory dataset diff"} <old-dataset.json> <new-dataset.json>

Options:
  --format markdown|json|csv|mapping|breaking|coverage
  --json
  --csv
  --output <path>
  --json-output <path>
  --markdown-output <path>
  --csv-output <path>
  --mapping-output <path>
  --breaking-output <path>
  --coverage-output <path>
  --performance-output <path>
  --automatic-confidence-threshold <0..1>
  --geometry-candidate-min-confidence <0..1>
  --fail-on-breaking
  --fail-on-review
  --force`);
}

function printDatasetMigrationPlanHelp(): void {
  console.log(`territory dataset migration-plan <old-dataset.json> <new-dataset.json>

Options:
  --format json|markdown
  --output <path>
  --mapping-output <path>
  --automatic-confidence-threshold <0..1>
  --fail-on-breaking
  --fail-on-review
  --force`);
}

function printDatasetBuildHelp(): void {
  console.log(`territory dataset build world-countries --source <natural-earth.geojson> --output <dir>
territory dataset build global-admin --output datasets/generated/global/ADM0

Options:
  --detail low|medium|high
  --country-artifact-root <dir[,dir]>   Optional country-detail artifact roots for coverage.
  --levels <ADM0[,ADM1...ADM5]>         Filter coverage output by administrative level.
  --build-report <report.json>
  --source-version <version>
  --source-url <url>
  --source-sha256 <sha256>
  --build-date <iso-date>
  --strict
  --force`);
}

function printDatasetBuildAllHelp(): void {
  console.log(`territory dataset build-all --levels ADM0 --output datasets/generated/global-adm0-countries --report reports/global-adm0-build-all.json

Options:
  --levels <ADM0[,ADM1...ADM5]>
  --countries <ISO2[,ISO2...]>
  --exclude <ISO2[,ISO2...]>
  --output <dir>
  --report <report.json>
  --max-source-bytes <bytes>            Defer oversized country-detail builds as performance-deferred.
  --country-timeout-ms <ms>
  --phase-timeout-ms <ms>
  --skip-adjacency                      Build country datasets without adjacency artifacts.
  --continue-on-error
  --allow-partial
  --concurrency <number>
  --cache-dir <dir>
  --offline
  --provider <id>
  --resume
  --retry-failed
  --force`);
}

function printCacheHelp(): void {
  console.log(`territory cache <command>

Commands:
  list       List installed dataset cache entries
  verify     Verify installed cache metadata
  clear      Clear the dataset artifact cache

Options:
  --cache-dir <dir>
  --force`);
}

const currentEntry = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined;

if (currentEntry === import.meta.url) {
  runCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
