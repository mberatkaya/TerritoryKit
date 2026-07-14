import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import {
  loadTerritoryDataset,
  repairGeometryDataset,
  validateTerritoryDataset,
  validateGeometryDataset
} from "@territory-kit/dataset";
import type {
  GeometryQualityOptions,
  GeometryQualityReport,
  GeometryRepairDatasetResult,
  GeometryRepairOptions,
  TerritoryDataset
} from "@territory-kit/dataset";
import { serializeJsonStable, writeFilesAtomically } from "./sources/utils.js";

export interface TerritoryDatasetPathInput {
  dataset: TerritoryDataset;
  datasetPath: string;
  sourcePath: string;
}

export interface GeometryQualityPathRepairOptions extends GeometryRepairOptions {
  force?: boolean;
}

export async function readTerritoryDatasetPath(
  inputPath: string
): Promise<TerritoryDatasetPathInput> {
  const sourcePath = resolve(inputPath);
  const stats = await stat(sourcePath);
  const datasetPath = stats.isDirectory() ? join(sourcePath, "dataset.json") : sourcePath;
  const input = JSON.parse(await readFile(datasetPath, "utf8")) as unknown;
  const validation = validateTerritoryDataset(input);

  return {
    dataset: validation.ok && validation.dataset ? validation.dataset : loadDatasetLike(input),
    datasetPath,
    sourcePath
  };
}

export async function validateTerritoryDatasetPath(
  inputPath: string,
  options: GeometryQualityOptions = {}
): Promise<{ input: TerritoryDatasetPathInput; report: GeometryQualityReport }> {
  const input = await readTerritoryDatasetPath(inputPath);

  return {
    input,
    report: validateGeometryDataset(input.dataset, options)
  };
}

export async function repairTerritoryDatasetPath(
  inputPath: string,
  outputPath: string,
  options: GeometryQualityPathRepairOptions = {}
): Promise<{
  input: TerritoryDatasetPathInput;
  result: GeometryRepairDatasetResult;
  outputPath: string;
}> {
  const input = await readTerritoryDatasetPath(inputPath);
  const resolvedOutputPath = resolve(outputPath);

  if (
    resolve(input.sourcePath) === resolvedOutputPath ||
    resolve(input.datasetPath) === resolvedOutputPath
  ) {
    throw new Error("Repair output path must be different from the input dataset path.");
  }

  const result = repairGeometryDataset(input.dataset, options);

  if (result.ok) {
    await writeTerritoryDatasetOutput(resolvedOutputPath, result.dataset, {
      ...(options.force ? { force: true } : {})
    });
  }

  return {
    input,
    result,
    outputPath: resolvedOutputPath
  };
}

export async function writeGeometryQualityReport(
  reportPath: string,
  report: GeometryQualityReport
): Promise<void> {
  await writeJsonFileAtomically(resolve(reportPath), report, { force: true });
}

export async function writeTerritoryDatasetOutput(
  outputPath: string,
  dataset: TerritoryDataset,
  options: { force?: boolean } = {}
): Promise<void> {
  if (extname(outputPath) === ".json") {
    await writeJsonFileAtomically(outputPath, dataset, options);
    return;
  }

  await writeFilesAtomically(
    outputPath,
    new Map([["dataset.json", serializeJsonStable(dataset)]]),
    options
  );
}

async function writeJsonFileAtomically(
  outputPath: string,
  input: unknown,
  options: { force?: boolean } = {}
): Promise<void> {
  if (!options.force && (await pathExists(outputPath))) {
    throw new Error(`Output path '${outputPath}' already exists.`);
  }

  await mkdir(dirname(outputPath), { recursive: true });
  const tempDirectory = await mkdtemp(join(dirname(outputPath), `.${basename(outputPath)}-tmp-`));
  const tempPath = join(tempDirectory, basename(outputPath));

  try {
    await writeFile(tempPath, serializeJsonStable(input), "utf8");
    await rename(tempPath, outputPath);
    await rm(tempDirectory, { force: true, recursive: true });
  } catch (error) {
    await rm(tempDirectory, { force: true, recursive: true });
    throw error;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function loadDatasetLike(input: unknown): TerritoryDataset {
  if (
    input &&
    typeof input === "object" &&
    "manifest" in input &&
    "zones" in input &&
    Array.isArray(input.zones)
  ) {
    const manifest = input.manifest;

    if (
      manifest &&
      typeof manifest === "object" &&
      "datasetId" in manifest &&
      typeof manifest.datasetId === "string"
    ) {
      return input as TerritoryDataset;
    }
  }

  return loadTerritoryDataset(input);
}
