import {
  decodeTerritoryBinarySpatialIndex,
  isTerritoryBinarySpatialIndex,
  type TerritoryBinarySpatialIndex,
  type TerritoryBinarySpatialIndexBuffer,
  type TerritoryBounds
} from "@territory-kit/core";
import { TerritoryError, loadTerritoryDataset } from "@territory-kit/dataset";
import type { TerritoryAdminLevel, TerritoryDataset, TerritoryZone } from "@territory-kit/dataset";

export type TerritoryCatalogArtifactPurpose = "query" | "render" | "index" | (string & {});

export interface TerritoryCatalogViewport {
  readonly bounds: TerritoryBounds;
  readonly zoom?: number;
  readonly level?: number;
}

export interface TerritoryCatalogDatasetRegistration {
  readonly dataset: TerritoryDataset;
  readonly datasetId?: string;
  readonly datasetVersion?: string;
  readonly country?: string;
  readonly level?: number | TerritoryAdminLevel;
  readonly levels?: readonly (number | TerritoryAdminLevel)[];
  readonly bounds?: TerritoryBounds;
  readonly parentId?: string;
  readonly priority?: number;
  readonly fallbackLevel?: number | TerritoryAdminLevel;
  readonly artifactPurpose?: TerritoryCatalogArtifactPurpose;
  readonly selectionGroup?: string;
  readonly geometryHash?: string;
  readonly indexHash?: string;
  readonly spatialIndex?: TerritoryBinarySpatialIndex | TerritoryBinarySpatialIndexBuffer;
}

export interface TerritoryCatalogEntry {
  readonly id: string;
  readonly dataset: TerritoryDataset;
  readonly datasetId: string;
  readonly datasetVersion: string;
  readonly country?: string;
  readonly levels: readonly number[];
  readonly bounds: TerritoryBounds;
  readonly parentId?: string;
  readonly priority: number;
  readonly fallbackLevel?: number;
  readonly artifactPurpose: TerritoryCatalogArtifactPurpose;
  readonly selectionGroup?: string;
  readonly geometryHash: string;
  readonly indexHash?: string;
  readonly spatialIndex?: TerritoryBinarySpatialIndex | TerritoryBinarySpatialIndexBuffer;
}

export interface TerritoryCatalogCoverage {
  readonly datasetId: string;
  readonly datasetVersion: string;
  readonly country?: string;
  readonly levels: readonly number[];
  readonly bounds: TerritoryBounds;
  readonly parentId?: string;
  readonly priority: number;
  readonly artifactPurpose: TerritoryCatalogArtifactPurpose;
  readonly selectionGroup?: string;
  readonly geometryHash: string;
  readonly indexHash?: string;
}

export interface TerritoryCatalogResolutionOptions {
  readonly level?: number;
  readonly country?: string;
  readonly parentId?: string;
  readonly artifactPurpose?: TerritoryCatalogArtifactPurpose;
}

export interface TerritoryCatalogMatch {
  readonly entry: TerritoryCatalogEntry;
  readonly level: number;
  readonly requestedLevel?: number;
  readonly matchType: "exact" | "fallback";
}

export interface TerritoryCatalogUnavailableCoverage {
  readonly reason: "no-coverage" | "level-unavailable";
  readonly bounds: TerritoryBounds;
  readonly requestedLevel?: number;
  readonly datasetId?: string;
  readonly country?: string;
}

export interface TerritoryCatalogPriorityDecision {
  readonly selectedEntryId: string;
  readonly excludedEntryId: string;
  readonly reason: "lower-priority" | "tie-breaker";
  readonly groupKey: string;
}

export interface TerritoryCatalogSelectedArtifact {
  readonly entryId: string;
  readonly dataset: TerritoryDataset;
  readonly datasetId: string;
  readonly datasetVersion: string;
  readonly country?: string;
  readonly level: number;
  readonly bounds: TerritoryBounds;
  readonly priority: number;
  readonly artifactPurpose: TerritoryCatalogArtifactPurpose;
  readonly selectionGroup?: string;
  readonly geometryHash: string;
  readonly indexHash?: string;
  readonly spatialIndex?: TerritoryBinarySpatialIndex | TerritoryBinarySpatialIndexBuffer;
}

export interface TerritoryCatalogResolutionPlan {
  readonly planId: string;
  readonly viewport: TerritoryCatalogViewport;
  readonly requestedLevel?: number;
  readonly exactMatches: readonly TerritoryCatalogMatch[];
  readonly fallbackMatches: readonly TerritoryCatalogMatch[];
  readonly unavailableCoverage: readonly TerritoryCatalogUnavailableCoverage[];
  readonly selectedArtifacts: readonly TerritoryCatalogSelectedArtifact[];
  readonly selectedLevels: readonly number[];
  readonly priorityDecisions: readonly TerritoryCatalogPriorityDecision[];
}

export interface TerritoryCatalogTerritoryResolution {
  readonly territoryId: string;
  readonly matches: readonly TerritoryCatalogTerritoryMatch[];
  readonly selected?: TerritoryCatalogTerritoryMatch;
}

export interface TerritoryCatalogTerritoryMatch {
  readonly entry: TerritoryCatalogEntry;
  readonly zone: TerritoryZone;
}

export interface TerritoryCatalog {
  readonly revision: number;
  listDatasets(): readonly TerritoryCatalogEntry[];
  registerDataset(input: TerritoryCatalogDatasetRegistration): TerritoryCatalogEntry;
  unregisterDataset(
    input: string | { readonly datasetId: string; readonly datasetVersion?: string }
  ): boolean;
  resolveViewport(
    viewport: TerritoryCatalogViewport,
    options?: TerritoryCatalogResolutionOptions
  ): TerritoryCatalogResolutionPlan;
  resolveTerritory(
    territoryId: string,
    options?: Pick<TerritoryCatalogResolutionOptions, "country" | "artifactPurpose">
  ): TerritoryCatalogTerritoryResolution;
  getCoverage(options?: TerritoryCatalogResolutionOptions): readonly TerritoryCatalogCoverage[];
  createResolutionPlan(
    viewport: TerritoryCatalogViewport,
    options?: TerritoryCatalogResolutionOptions
  ): TerritoryCatalogResolutionPlan;
}

export function createTerritoryCatalog(
  registrations: readonly TerritoryCatalogDatasetRegistration[] = []
): TerritoryCatalog {
  const entries = new Map<string, TerritoryCatalogEntry>();
  let revision = 0;

  const catalog: TerritoryCatalog = {
    get revision() {
      return revision;
    },
    listDatasets() {
      return freezeEntries([...entries.values()].sort(compareEntries));
    },
    registerDataset(input) {
      const entry = normalizeRegistration(input);
      const existing = entries.get(entry.id);

      if (existing) {
        if (catalogEntriesEquivalent(existing, entry)) {
          return existing;
        }

        throw new TerritoryError(
          "RUNTIME_CONFIGURATION_INVALID",
          "Catalog entry id is already registered with a conflicting configuration.",
          {
            details: {
              entryId: entry.id,
              datasetId: entry.datasetId,
              datasetVersion: entry.datasetVersion
            }
          }
        );
      }

      entries.set(entry.id, entry);
      revision += 1;
      return entry;
    },
    unregisterDataset(input) {
      const before = entries.size;

      if (typeof input === "string") {
        if (!entries.delete(input)) {
          for (const [entryId, entry] of entries.entries()) {
            if (entry.datasetId === input) {
              entries.delete(entryId);
            }
          }
        }
      } else {
        for (const [entryId, entry] of entries.entries()) {
          if (
            entry.datasetId === input.datasetId &&
            (input.datasetVersion === undefined || entry.datasetVersion === input.datasetVersion)
          ) {
            entries.delete(entryId);
          }
        }
      }

      if (entries.size !== before) {
        revision += 1;
        return true;
      }

      return false;
    },
    resolveViewport(viewport, options = {}) {
      return catalog.createResolutionPlan(viewport, options);
    },
    resolveTerritory(territoryId, options = {}) {
      const purpose = options.artifactPurpose ?? "query";
      const matches = [...entries.values()]
        .filter(
          (entry) =>
            entry.artifactPurpose === purpose &&
            (!options.country || entry.country === normalizeCountry(options.country))
        )
        .flatMap((entry): TerritoryCatalogTerritoryMatch[] => {
          const zone = entry.dataset.zones.find((candidate) => candidate.id === territoryId);
          return zone ? [{ entry, zone }] : [];
        })
        .sort(compareTerritoryMatches);

      return Object.freeze({
        territoryId,
        matches: Object.freeze(matches),
        ...(matches[0] ? { selected: matches[0] } : {})
      });
    },
    getCoverage(options = {}) {
      const purpose = options.artifactPurpose ?? "query";
      const level = options.level;
      const country = options.country ? normalizeCountry(options.country) : undefined;

      return Object.freeze(
        [...entries.values()]
          .filter(
            (entry) =>
              entry.artifactPurpose === purpose &&
              (country === undefined || entry.country === country) &&
              (options.parentId === undefined || entry.parentId === options.parentId) &&
              (level === undefined || entry.levels.includes(level))
          )
          .sort(compareEntries)
          .map((entry) =>
            Object.freeze({
              datasetId: entry.datasetId,
              datasetVersion: entry.datasetVersion,
              ...(entry.country ? { country: entry.country } : {}),
              levels: Object.freeze([...entry.levels]),
              bounds: freezeBounds(entry.bounds),
              ...(entry.parentId ? { parentId: entry.parentId } : {}),
              priority: entry.priority,
              artifactPurpose: entry.artifactPurpose,
              ...(entry.selectionGroup ? { selectionGroup: entry.selectionGroup } : {}),
              geometryHash: entry.geometryHash,
              ...(entry.indexHash ? { indexHash: entry.indexHash } : {})
            })
          )
      );
    },
    createResolutionPlan(viewport, options = {}) {
      const normalizedViewport = normalizeViewport(viewport);
      const requestedLevel =
        options.level ?? normalizedViewport.level ?? inferLevelFromZoom(normalizedViewport.zoom);
      const purpose = options.artifactPurpose ?? "query";
      const country = options.country ? normalizeCountry(options.country) : undefined;
      const candidates = [...entries.values()]
        .filter(
          (entry) =>
            entry.artifactPurpose === purpose &&
            boundsIntersect(entry.bounds, normalizedViewport.bounds) &&
            (country === undefined || entry.country === country) &&
            (options.parentId === undefined || entry.parentId === options.parentId)
        )
        .sort(compareEntries);
      const exactMatches: TerritoryCatalogMatch[] = [];
      const fallbackMatches: TerritoryCatalogMatch[] = [];
      const unavailableCoverage: TerritoryCatalogUnavailableCoverage[] = [];

      for (const entry of candidates) {
        const match = resolveEntryLevel(entry, requestedLevel);

        if (!match) {
          unavailableCoverage.push(
            Object.freeze({
              reason: "level-unavailable",
              bounds: freezeBounds(normalizedViewport.bounds),
              datasetId: entry.datasetId,
              ...(requestedLevel !== undefined ? { requestedLevel } : {}),
              ...(entry.country ? { country: entry.country } : {})
            })
          );
          continue;
        }

        if (match.matchType === "exact") {
          exactMatches.push(match);
        } else {
          fallbackMatches.push(match);
        }
      }

      if (candidates.length === 0) {
        unavailableCoverage.push(
          Object.freeze({
            reason: "no-coverage",
            bounds: freezeBounds(normalizedViewport.bounds),
            ...(requestedLevel !== undefined ? { requestedLevel } : {}),
            ...(country ? { country } : {})
          })
        );
      }

      const { selectedMatches, priorityDecisions } = selectMatches([
        ...exactMatches,
        ...fallbackMatches
      ]);
      const selectedArtifacts = selectedMatches.map(createSelectedArtifact);
      const selectedLevels = [...new Set(selectedArtifacts.map((artifact) => artifact.level))].sort(
        (left, right) => left - right
      );
      const planId = stableJson({
        revision,
        viewport: normalizedViewport,
        requestedLevel,
        selected: selectedArtifacts.map((artifact) => ({
          entryId: artifact.entryId,
          level: artifact.level,
          priority: artifact.priority
        })),
        unavailable: unavailableCoverage.map((coverage) => coverage.reason)
      });

      return Object.freeze({
        planId,
        viewport: normalizedViewport,
        ...(requestedLevel !== undefined ? { requestedLevel } : {}),
        exactMatches: Object.freeze(exactMatches),
        fallbackMatches: Object.freeze(fallbackMatches),
        unavailableCoverage: Object.freeze(unavailableCoverage),
        selectedArtifacts: Object.freeze(selectedArtifacts),
        selectedLevels: Object.freeze(selectedLevels),
        priorityDecisions: Object.freeze(priorityDecisions)
      });
    }
  };

  for (const registration of registrations) {
    catalog.registerDataset(registration);
  }

  return catalog;
}

export function isTerritoryCatalog(input: unknown): input is TerritoryCatalog {
  return (
    isRecord(input) &&
    typeof input.registerDataset === "function" &&
    typeof input.createResolutionPlan === "function" &&
    typeof input.resolveViewport === "function"
  );
}

function normalizeRegistration(input: TerritoryCatalogDatasetRegistration): TerritoryCatalogEntry {
  const dataset = loadTerritoryDataset(input.dataset);
  assertRegistrationIdentity(input, dataset);
  const levels = normalizeLevels(input, dataset);
  const datasetId = dataset.manifest.datasetId;
  const datasetVersion = dataset.manifest.datasetVersion;
  const country =
    input.country ??
    (dataset.manifest.countryCodes?.length === 1 ? dataset.manifest.countryCodes[0] : undefined);
  const normalizedCountry = country ? normalizeCountry(country) : undefined;
  assertRegistrationCountry(normalizedCountry, dataset);
  const geometryHash = dataset.manifest.geometryHash;
  const spatialIndexMetadata = input.spatialIndex
    ? readSpatialIndexMetadata(input.spatialIndex)
    : undefined;
  assertSpatialIndexMetadata(spatialIndexMetadata, dataset);
  const indexHash = input.indexHash ?? spatialIndexMetadata?.indexHash;

  if (
    input.indexHash !== undefined &&
    spatialIndexMetadata?.indexHash !== undefined &&
    input.indexHash !== spatialIndexMetadata.indexHash
  ) {
    throw new TerritoryError(
      "RUNTIME_CONFIGURATION_INVALID",
      "Catalog registration indexHash does not match the binary spatial index metadata.",
      {
        details: { expected: spatialIndexMetadata.indexHash, actual: input.indexHash }
      }
    );
  }

  const priority = input.priority ?? 0;

  if (!Number.isFinite(priority)) {
    throw new TerritoryError(
      "RUNTIME_CONFIGURATION_INVALID",
      "Catalog registration priority must be finite.",
      {
        details: { priority }
      }
    );
  }

  const bounds = normalizeCatalogBounds(input.bounds ?? boundsForDataset(dataset));
  const datasetBounds = boundsForDataset(dataset);

  if (!boundsContain(bounds, datasetBounds)) {
    throw new TerritoryError(
      "RUNTIME_CONFIGURATION_INVALID",
      "Catalog registration bounds must contain the dataset coverage bounds.",
      {
        details: { bounds, datasetBounds }
      }
    );
  }

  const fallbackLevel =
    input.fallbackLevel !== undefined ? normalizeLevel(input.fallbackLevel) : undefined;

  if (fallbackLevel !== undefined && !levels.includes(fallbackLevel)) {
    throw new TerritoryError(
      "RUNTIME_CONFIGURATION_INVALID",
      "Catalog fallbackLevel must be present in the registered levels.",
      {
        details: { fallbackLevel, levels }
      }
    );
  }

  const entry: TerritoryCatalogEntry = {
    id: createEntryId({
      datasetId,
      datasetVersion,
      ...(normalizedCountry ? { country: normalizedCountry } : {}),
      levels,
      ...(input.parentId ? { parentId: input.parentId } : {}),
      artifactPurpose: input.artifactPurpose ?? "query"
    }),
    dataset,
    datasetId,
    datasetVersion,
    ...(normalizedCountry ? { country: normalizedCountry } : {}),
    levels,
    bounds,
    ...(input.parentId ? { parentId: input.parentId } : {}),
    priority,
    ...(fallbackLevel !== undefined ? { fallbackLevel } : {}),
    artifactPurpose: input.artifactPurpose ?? "query",
    ...(input.selectionGroup ? { selectionGroup: input.selectionGroup } : {}),
    geometryHash,
    ...(indexHash ? { indexHash } : {}),
    ...(input.spatialIndex ? { spatialIndex: input.spatialIndex } : {})
  };

  return Object.freeze(entry);
}

function normalizeLevels(
  input: TerritoryCatalogDatasetRegistration,
  dataset: TerritoryDataset
): readonly number[] {
  const levels = input.levels ?? (input.level !== undefined ? [input.level] : undefined);
  const normalized = levels?.map(normalizeLevel) ?? [
    ...new Set(dataset.zones.map((zone) => zone.level))
  ];
  const availableLevels = new Set(dataset.zones.map((zone) => zone.level));

  if (normalized.length === 0) {
    return Object.freeze([]);
  }

  const uniqueLevels = [...new Set(normalized)].sort((left, right) => left - right);
  const missingLevel = uniqueLevels.find((level) => !availableLevels.has(level));

  if (missingLevel !== undefined) {
    throw new TerritoryError(
      "RUNTIME_CONFIGURATION_INVALID",
      "Catalog registration levels must exist in the dataset.",
      {
        details: {
          level: missingLevel,
          availableLevels: [...availableLevels].sort((left, right) => left - right)
        }
      }
    );
  }

  return Object.freeze(uniqueLevels);
}

function normalizeLevel(level: number | TerritoryAdminLevel): number {
  if (typeof level === "string") {
    const depth = Number(level.slice(3));

    if (!level.startsWith("ADM") || !Number.isInteger(depth) || depth < 0) {
      throw new TerritoryError("INVALID_LEVEL", `Catalog level '${level}' is invalid.`);
    }

    return depth;
  }

  if (!Number.isInteger(level) || level < 0) {
    throw new TerritoryError("INVALID_LEVEL", `Catalog level '${level}' is invalid.`);
  }

  return level;
}

function assertRegistrationIdentity(
  input: TerritoryCatalogDatasetRegistration,
  dataset: TerritoryDataset
): void {
  const mismatches = [
    ["datasetId", input.datasetId, dataset.manifest.datasetId],
    ["datasetVersion", input.datasetVersion, dataset.manifest.datasetVersion],
    ["geometryHash", input.geometryHash, dataset.manifest.geometryHash]
  ].filter(
    ([, expectedValue, actualValue]) => expectedValue !== undefined && expectedValue !== actualValue
  );

  if (mismatches.length === 0) {
    return;
  }

  throw new TerritoryError(
    "RUNTIME_CONFIGURATION_INVALID",
    "Catalog registration metadata must match the dataset manifest.",
    {
      details: Object.fromEntries(
        mismatches.map(([field, expectedValue, actualValue]) => [
          String(field),
          { expected: String(actualValue), actual: String(expectedValue) }
        ])
      )
    }
  );
}

function assertRegistrationCountry(country: string | undefined, dataset: TerritoryDataset): void {
  const manifestCountries = dataset.manifest.countryCodes?.map(normalizeCountry) ?? [];
  const zoneCountries = [
    ...new Set(
      dataset.zones
        .map((zone) => zone.countryCode)
        .filter((countryCode): countryCode is string => Boolean(countryCode))
        .map(normalizeCountry)
    )
  ];
  const knownCountries = manifestCountries.length > 0 ? manifestCountries : zoneCountries;

  if (!country || knownCountries.length === 0 || knownCountries.includes(country)) {
    return;
  }

  throw new TerritoryError(
    "RUNTIME_CONFIGURATION_INVALID",
    "Catalog registration country conflicts with the dataset manifest countryCodes.",
    {
      details: { country, countryCodes: knownCountries }
    }
  );
}

function readSpatialIndexMetadata(
  spatialIndex: TerritoryBinarySpatialIndex | TerritoryBinarySpatialIndexBuffer
): TerritoryBinarySpatialIndex["metadata"] {
  return isTerritoryBinarySpatialIndex(spatialIndex)
    ? spatialIndex.metadata
    : decodeTerritoryBinarySpatialIndex(spatialIndex).metadata;
}

function assertSpatialIndexMetadata(
  metadata: TerritoryBinarySpatialIndex["metadata"] | undefined,
  dataset: TerritoryDataset
): void {
  if (!metadata) {
    return;
  }

  const mismatches = [
    ["datasetId", metadata.datasetId, dataset.manifest.datasetId],
    ["datasetVersion", metadata.datasetVersion, dataset.manifest.datasetVersion],
    ["geometryHash", metadata.geometryHash, dataset.manifest.geometryHash]
  ].filter(([, actualValue, expectedValue]) => actualValue !== expectedValue);

  if (mismatches.length === 0) {
    return;
  }

  throw new TerritoryError(
    "RUNTIME_CONFIGURATION_INVALID",
    "Catalog spatialIndex metadata must match the dataset manifest.",
    {
      details: Object.fromEntries(
        mismatches.map(([field, actualValue, expectedValue]) => [
          String(field),
          { expected: String(expectedValue), actual: String(actualValue) }
        ])
      )
    }
  );
}

function normalizeViewport(viewport: TerritoryCatalogViewport): TerritoryCatalogViewport {
  return Object.freeze({
    bounds: freezeBounds(viewport.bounds),
    ...(viewport.zoom !== undefined ? { zoom: viewport.zoom } : {}),
    ...(viewport.level !== undefined ? { level: viewport.level } : {})
  });
}

function inferLevelFromZoom(zoom: number | undefined): number | undefined {
  if (zoom === undefined) {
    return undefined;
  }

  if (zoom < 5) {
    return 0;
  }

  if (zoom < 8) {
    return 1;
  }

  if (zoom < 12) {
    return 2;
  }

  if (zoom < 15) {
    return 3;
  }

  if (zoom < 18) {
    return 4;
  }

  return 5;
}

function resolveEntryLevel(
  entry: TerritoryCatalogEntry,
  requestedLevel: number | undefined
): TerritoryCatalogMatch | undefined {
  if (requestedLevel === undefined) {
    const level = entry.levels.at(-1);
    return level === undefined
      ? undefined
      : Object.freeze({ entry, level, matchType: "exact" as const });
  }

  if (entry.levels.includes(requestedLevel)) {
    return Object.freeze({ entry, level: requestedLevel, requestedLevel, matchType: "exact" });
  }

  const fallbackLevel =
    entry.fallbackLevel !== undefined && entry.levels.includes(entry.fallbackLevel)
      ? entry.fallbackLevel
      : [...entry.levels].reverse().find((level) => level < requestedLevel);

  if (fallbackLevel === undefined) {
    return undefined;
  }

  return Object.freeze({
    entry,
    level: fallbackLevel,
    requestedLevel,
    matchType: "fallback"
  });
}

function selectMatches(matches: readonly TerritoryCatalogMatch[]): {
  readonly selectedMatches: readonly TerritoryCatalogMatch[];
  readonly priorityDecisions: readonly TerritoryCatalogPriorityDecision[];
} {
  const selectedMatches: TerritoryCatalogMatch[] = [];
  const priorityDecisions: TerritoryCatalogPriorityDecision[] = [];

  for (const candidate of [...matches].sort(compareMatches)) {
    const selected = selectedMatches.find((match) => matchesCompete(match, candidate));

    if (!selected) {
      selectedMatches.push(candidate);
      continue;
    }

    priorityDecisions.push(
      Object.freeze({
        selectedEntryId: selected.entry.id,
        excludedEntryId: candidate.entry.id,
        reason:
          selected.entry.priority === candidate.entry.priority ? "tie-breaker" : "lower-priority",
        groupKey: selectionGroupKey(selected, candidate)
      })
    );
  }

  return {
    selectedMatches: Object.freeze(selectedMatches.sort(compareMatches)),
    priorityDecisions: Object.freeze(priorityDecisions)
  };
}

function createSelectedArtifact(match: TerritoryCatalogMatch): TerritoryCatalogSelectedArtifact {
  const entry = match.entry;

  return Object.freeze({
    entryId: entry.id,
    dataset: entry.dataset,
    datasetId: entry.datasetId,
    datasetVersion: entry.datasetVersion,
    ...(entry.country ? { country: entry.country } : {}),
    level: match.level,
    bounds: freezeBounds(entry.bounds),
    priority: entry.priority,
    artifactPurpose: entry.artifactPurpose,
    ...(entry.selectionGroup ? { selectionGroup: entry.selectionGroup } : {}),
    geometryHash: entry.geometryHash,
    ...(entry.indexHash ? { indexHash: entry.indexHash } : {}),
    ...(entry.spatialIndex ? { spatialIndex: entry.spatialIndex } : {})
  });
}

function boundsForDataset(dataset: TerritoryDataset): TerritoryBounds {
  if (dataset.zones.length === 0) {
    return freezeBounds({ west: 0, south: 0, east: 0, north: 0 });
  }

  return freezeBounds({
    west: Math.min(...dataset.zones.map((zone) => zone.bbox[0])),
    south: Math.min(...dataset.zones.map((zone) => zone.bbox[1])),
    east: Math.max(...dataset.zones.map((zone) => zone.bbox[2])),
    north: Math.max(...dataset.zones.map((zone) => zone.bbox[3]))
  });
}

function freezeBounds(bounds: TerritoryBounds): TerritoryBounds {
  return Object.freeze({
    west: bounds.west,
    south: bounds.south,
    east: bounds.east,
    north: bounds.north
  });
}

function normalizeCatalogBounds(bounds: TerritoryBounds): TerritoryBounds {
  const normalized = freezeBounds(bounds);

  if (
    !Number.isFinite(normalized.west) ||
    !Number.isFinite(normalized.south) ||
    !Number.isFinite(normalized.east) ||
    !Number.isFinite(normalized.north)
  ) {
    throw new TerritoryError(
      "RUNTIME_CONFIGURATION_INVALID",
      "Catalog registration bounds must be finite.",
      {
        details: { bounds: normalized }
      }
    );
  }

  if (normalized.west > normalized.east || normalized.south > normalized.north) {
    throw new TerritoryError(
      "RUNTIME_CONFIGURATION_INVALID",
      "Catalog registration bounds must be sorted west/east and south/north.",
      {
        details: { bounds: normalized }
      }
    );
  }

  return normalized;
}

function boundsIntersect(left: TerritoryBounds, right: TerritoryBounds): boolean {
  return (
    left.west <= right.east &&
    left.east >= right.west &&
    left.south <= right.north &&
    left.north >= right.south
  );
}

function boundsContain(outer: TerritoryBounds, inner: TerritoryBounds): boolean {
  return (
    outer.west <= inner.west &&
    outer.south <= inner.south &&
    outer.east >= inner.east &&
    outer.north >= inner.north
  );
}

function createEntryId(input: {
  readonly datasetId: string;
  readonly datasetVersion: string;
  readonly country?: string;
  readonly levels: readonly number[];
  readonly parentId?: string;
  readonly artifactPurpose: TerritoryCatalogArtifactPurpose;
}): string {
  return [
    input.datasetId,
    input.datasetVersion,
    input.country ? normalizeCountry(input.country) : "*",
    input.levels.join(","),
    input.parentId ?? "*",
    input.artifactPurpose
  ].join(":");
}

function compareMatches(left: TerritoryCatalogMatch, right: TerritoryCatalogMatch): number {
  return (
    matchTypeRank(left.matchType) - matchTypeRank(right.matchType) ||
    right.entry.priority - left.entry.priority ||
    left.entry.id.localeCompare(right.entry.id)
  );
}

function matchesCompete(left: TerritoryCatalogMatch, right: TerritoryCatalogMatch): boolean {
  if (
    (left.entry.country ?? left.entry.datasetId) !==
      (right.entry.country ?? right.entry.datasetId) ||
    (left.entry.parentId ?? "") !== (right.entry.parentId ?? "") ||
    left.level !== right.level ||
    left.entry.artifactPurpose !== right.entry.artifactPurpose
  ) {
    return false;
  }

  if (left.entry.selectionGroup || right.entry.selectionGroup) {
    return (
      left.entry.selectionGroup !== undefined &&
      left.entry.selectionGroup === right.entry.selectionGroup
    );
  }

  return boundsIntersect(left.entry.bounds, right.entry.bounds);
}

function selectionGroupKey(left: TerritoryCatalogMatch, right: TerritoryCatalogMatch): string {
  return [
    left.entry.country ?? left.entry.datasetId,
    left.entry.parentId ?? "",
    left.level,
    left.entry.artifactPurpose,
    left.entry.selectionGroup ?? right.entry.selectionGroup ?? "overlap"
  ].join(":");
}

function matchTypeRank(matchType: TerritoryCatalogMatch["matchType"]): number {
  return matchType === "exact" ? 0 : 1;
}

function compareEntries(left: TerritoryCatalogEntry, right: TerritoryCatalogEntry): number {
  return (
    right.priority - left.priority ||
    left.datasetId.localeCompare(right.datasetId) ||
    left.datasetVersion.localeCompare(right.datasetVersion) ||
    (left.country ?? "").localeCompare(right.country ?? "") ||
    left.levels.join(",").localeCompare(right.levels.join(","))
  );
}

function compareTerritoryMatches(
  left: TerritoryCatalogTerritoryMatch,
  right: TerritoryCatalogTerritoryMatch
): number {
  return compareEntries(left.entry, right.entry) || left.zone.id.localeCompare(right.zone.id);
}

function catalogEntriesEquivalent(
  left: TerritoryCatalogEntry,
  right: TerritoryCatalogEntry
): boolean {
  return stableJson(entryComparisonPayload(left)) === stableJson(entryComparisonPayload(right));
}

function entryComparisonPayload(entry: TerritoryCatalogEntry): unknown {
  return {
    id: entry.id,
    datasetId: entry.datasetId,
    datasetVersion: entry.datasetVersion,
    geometryHash: entry.geometryHash,
    indexHash: entry.indexHash ?? "",
    country: entry.country ?? "",
    levels: entry.levels,
    bounds: entry.bounds,
    parentId: entry.parentId ?? "",
    priority: entry.priority,
    fallbackLevel: entry.fallbackLevel ?? "",
    artifactPurpose: entry.artifactPurpose,
    selectionGroup: entry.selectionGroup ?? "",
    hasSpatialIndex: Boolean(entry.spatialIndex),
    manifest: entry.dataset.manifest,
    zones: entry.dataset.zones
  };
}

function freezeEntries(
  entries: readonly TerritoryCatalogEntry[]
): readonly TerritoryCatalogEntry[] {
  return Object.freeze([...entries]);
}

function normalizeCountry(country: string): string {
  return country.toUpperCase();
}

function stableJson(input: unknown): string {
  return JSON.stringify(sortStable(input));
}

function sortStable(input: unknown): unknown {
  if (Array.isArray(input)) {
    return input.map(sortStable);
  }

  if (!isRecord(input)) {
    return input;
  }

  return Object.fromEntries(
    Object.entries(input)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, sortStable(value)])
  );
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null;
}
