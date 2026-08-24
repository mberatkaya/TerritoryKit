import {
  createTerritoryGeometryVersion,
  type TerritoryDataset,
  type TerritorySourceClass,
  type TerritoryZone
} from "@territory-kit/dataset";
import type { TerritoryDatasetVersionInfo, TerritoryIdentity } from "./types.js";

export function createTerritoryDatasetVersionInfo(
  dataset: TerritoryDataset
): TerritoryDatasetVersionInfo {
  const manifest = dataset.manifest;

  return {
    datasetId: manifest.datasetId,
    datasetVersion: manifest.datasetVersion,
    geometryHash: manifest.geometryHash,
    sourceDate: manifest.sourceDate,
    ...(manifest.buildDate ? { buildDate: manifest.buildDate } : {}),
    ...(manifest.sourceProvider ? { sourceProvider: manifest.sourceProvider } : {}),
    ...(manifest.artifactChecksum ? { artifactChecksum: manifest.artifactChecksum } : {})
  };
}

export function createTerritoryIdentity(
  dataset: TerritoryDataset,
  zone: TerritoryZone
): TerritoryIdentity {
  const territory = readTerritoryMetadata(zone);
  const source = readRecord(territory?.source);
  const computedGeometryVersion = createTerritoryGeometryVersion(zone.geometry);
  const geometryHash =
    readString(territory?.effectiveGeometryHash) ??
    readString(territory?.geometryHash) ??
    computedGeometryVersion;
  const geometryVersion =
    readString(territory?.geometryVersion) ?? readString(territory?.revision) ?? geometryHash;
  const sourceClass =
    readSourceClass(territory?.sourceClass) ?? readSourceClass(source?.sourceClass);
  const sourceProvider = readString(territory?.sourceProvider) ?? readString(source?.provider);
  const sourceNativeId =
    readString(territory?.sourceNativeId) ??
    readString(territory?.sourceId) ??
    readString(source?.sourceNativeId) ??
    readString(source?.sourceId);
  const stableId = readString(territory?.stableId);

  return {
    territoryId: zone.id,
    datasetId: zone.datasetId || dataset.manifest.datasetId,
    datasetVersion: dataset.manifest.datasetVersion,
    geometryVersion,
    geometryHash,
    ...(stableId ? { stableId } : {}),
    ...(sourceClass ? { sourceClass } : {}),
    ...(sourceProvider ? { sourceProvider } : {}),
    ...(sourceNativeId ? { sourceNativeId } : {})
  };
}

function readTerritoryMetadata(zone: TerritoryZone): Record<string, unknown> | undefined {
  return readRecord(zone.properties.territory);
}

function readRecord(input: unknown): Record<string, unknown> | undefined {
  return typeof input === "object" && input !== null && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : undefined;
}

function readString(input: unknown): string | undefined {
  return typeof input === "string" && input.length > 0 ? input : undefined;
}

function readSourceClass(input: unknown): TerritorySourceClass | undefined {
  return input === "official" || input === "osm" || input === "generated" ? input : undefined;
}
