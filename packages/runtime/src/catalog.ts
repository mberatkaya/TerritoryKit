import {
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
  const levels = normalizeLevels(input);
  const datasetId = input.datasetId ?? dataset.manifest.datasetId;
  const datasetVersion = input.datasetVersion ?? dataset.manifest.datasetVersion;
  const country =
    input.country ??
    (dataset.manifest.countryCodes?.length === 1 ? dataset.manifest.countryCodes[0] : undefined);
  const geometryHash = input.geometryHash ?? dataset.manifest.geometryHash;
  const indexHash =
    input.indexHash ??
    (isTerritoryBinarySpatialIndex(input.spatialIndex)
      ? input.spatialIndex.metadata.indexHash
      : undefined);
  const entry: TerritoryCatalogEntry = {
    id: createEntryId({
      datasetId,
      datasetVersion,
      ...(country ? { country } : {}),
      levels,
      ...(input.parentId ? { parentId: input.parentId } : {}),
      artifactPurpose: input.artifactPurpose ?? "query"
    }),
    dataset,
    datasetId,
    datasetVersion,
    ...(country ? { country: normalizeCountry(country) } : {}),
    levels,
    bounds: freezeBounds(input.bounds ?? boundsForDataset(dataset)),
    ...(input.parentId ? { parentId: input.parentId } : {}),
    priority: input.priority ?? 0,
    ...(input.fallbackLevel !== undefined
      ? { fallbackLevel: normalizeLevel(input.fallbackLevel) }
      : {}),
    artifactPurpose: input.artifactPurpose ?? "query",
    geometryHash,
    ...(indexHash ? { indexHash } : {}),
    ...(input.spatialIndex ? { spatialIndex: input.spatialIndex } : {})
  };

  return Object.freeze(entry);
}

function normalizeLevels(input: TerritoryCatalogDatasetRegistration): readonly number[] {
  const levels = input.levels ?? (input.level !== undefined ? [input.level] : undefined);
  const normalized = levels?.map(normalizeLevel) ?? [
    ...new Set(input.dataset.zones.map((zone) => zone.level))
  ];

  if (normalized.length === 0) {
    return Object.freeze([]);
  }

  return Object.freeze([...new Set(normalized)].sort((left, right) => left - right));
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
  const groups = new Map<string, TerritoryCatalogMatch[]>();

  for (const match of matches) {
    const groupKey = [
      match.entry.country ?? match.entry.datasetId,
      match.entry.parentId ?? "",
      match.level,
      match.entry.artifactPurpose
    ].join(":");
    const group = groups.get(groupKey) ?? [];
    group.push(match);
    groups.set(groupKey, group);
  }

  const selectedMatches: TerritoryCatalogMatch[] = [];
  const priorityDecisions: TerritoryCatalogPriorityDecision[] = [];

  for (const [groupKey, group] of groups.entries()) {
    const sorted = [...group].sort(compareMatches);
    const selected = sorted[0];

    if (!selected) {
      continue;
    }

    selectedMatches.push(selected);

    for (const excluded of sorted.slice(1)) {
      priorityDecisions.push(
        Object.freeze({
          selectedEntryId: selected.entry.id,
          excludedEntryId: excluded.entry.id,
          reason:
            selected.entry.priority === excluded.entry.priority ? "tie-breaker" : "lower-priority",
          groupKey
        })
      );
    }
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

function boundsIntersect(left: TerritoryBounds, right: TerritoryBounds): boolean {
  return (
    left.west <= right.east &&
    left.east >= right.west &&
    left.south <= right.north &&
    left.north >= right.south
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
