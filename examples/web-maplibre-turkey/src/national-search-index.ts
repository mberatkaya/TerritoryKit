import type { TerritoryAdminLevel, TerritoryZone } from "@territory-kit/dataset";

/** Pilot naming pairs documented in scripts/tr-sprint-2-istanbul-pilot.mjs */
const DOCUMENTED_DISTRICT_SEARCH_ALIASES: ReadonlyArray<{
  alias: string;
  canonicalName: string;
}> = [{ alias: "Adalar", canonicalName: "Prince Islands" }];

export interface NationalQueryArtifactEntry {
  id: string;
  name?: string;
  level: number;
  parentId?: string;
  sourceAdminLevel?: string;
  semanticType?: string;
  bbox?: [number, number, number, number];
  center?: [number, number];
}

export interface NationalQueryArtifactPayload {
  schemaVersion: string;
  datasetId: string;
  datasetVersion: string;
  zoneCount: number;
  byId: Record<string, NationalQueryArtifactEntry>;
}

export interface SmartCoverageSearchRow {
  adm2Id: string;
  district?: string;
  province?: string;
}

export interface NationalSearchIndexReport {
  adm1Indexed: number;
  adm2Indexed: number;
  missingNameIds: string[];
  aliasCount: number;
}

export interface NationalSearchIndex {
  zonesById: Map<string, TerritoryZone>;
  searchAliasesById: Map<string, readonly string[]>;
  report: NationalSearchIndexReport;
}

export function buildNationalSearchIndex(
  artifact: NationalQueryArtifactPayload,
  smartCoverageRows: readonly SmartCoverageSearchRow[] = []
): NationalSearchIndex {
  const zonesById = new Map<string, TerritoryZone>();
  const searchAliasesById = new Map<string, readonly string[]>();
  const missingNameIds: string[] = [];
  let adm1Indexed = 0;
  let adm2Indexed = 0;

  for (const entry of Object.values(artifact.byId ?? {})) {
    if (entry.level !== 1 && entry.level !== 2) {
      continue;
    }

    const displayName = readNonEmptyString(entry.name);
    if (!displayName) {
      missingNameIds.push(entry.id);
    }

    const center = entry.center ?? [0, 0];
    const bbox = entry.bbox ?? [center[0], center[1], center[0], center[1]];
    const zone = {
      id: entry.id,
      level: entry.level,
      datasetId: artifact.datasetId,
      neighborIds: [],
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [bbox[0], bbox[1]],
            [bbox[2], bbox[1]],
            [bbox[2], bbox[3]],
            [bbox[0], bbox[3]],
            [bbox[0], bbox[1]]
          ]
        ]
      },
      center,
      bbox,
      ...(displayName ? { name: displayName, localName: displayName } : {}),
      ...(entry.parentId ? { parentId: entry.parentId } : {}),
      ...(entry.sourceAdminLevel
        ? { sourceAdminLevel: entry.sourceAdminLevel as TerritoryZone["sourceAdminLevel"] }
        : {}),
      ...(entry.semanticType
        ? { semanticType: entry.semanticType as TerritoryZone["semanticType"] }
        : {}),
      properties: {
        ...(displayName ? { name: displayName } : {})
      }
    } as TerritoryZone;
    zonesById.set(entry.id, zone);

    if (entry.level === 1) {
      adm1Indexed += 1;
    } else {
      adm2Indexed += 1;
    }
  }

  for (const row of smartCoverageRows) {
    const zone = zonesById.get(row.adm2Id);
    if (!zone) {
      continue;
    }

    const labels = [row.district, row.province].filter((value): value is string =>
      Boolean(readNonEmptyString(value))
    );
    if (labels.length === 0) {
      continue;
    }

    zone.properties = {
      ...zone.properties,
      smartCoverageDistrict: row.district,
      smartCoverageProvince: row.province
    };
  }

  let aliasCount = 0;
  for (const mapping of DOCUMENTED_DISTRICT_SEARCH_ALIASES) {
    for (const zone of zonesById.values()) {
      if (zone.level !== 2) {
        continue;
      }

      const zoneName = displayZoneName(zone);
      if (zoneName !== mapping.canonicalName) {
        continue;
      }

      const existing = searchAliasesById.get(zone.id) ?? [];
      if (!existing.includes(mapping.alias)) {
        const nextAliases = [...existing, mapping.alias];
        searchAliasesById.set(zone.id, nextAliases);
        zone.properties = {
          ...zone.properties,
          searchAliases: nextAliases
        };
        aliasCount += 1;
      }
    }
  }

  for (const zone of zonesById.values()) {
    if (zone.level !== 2) {
      continue;
    }

    const aliases = searchAliasesById.get(zone.id) ?? [];
    zone.properties = {
      ...zone.properties,
      searchText: [zone.name, zone.localName, ...aliases].filter(Boolean).join(" ")
    };
  }

  missingNameIds.sort();

  return {
    zonesById,
    searchAliasesById,
    report: {
      adm1Indexed,
      adm2Indexed,
      missingNameIds,
      aliasCount
    }
  };
}

export function searchZonesFromNationalIndex(
  index: NationalSearchIndex,
  levels: readonly TerritoryAdminLevel[]
): TerritoryZone[] {
  const depths = new Set(levels.map((level) => Number(level.slice(3))));
  return [...index.zonesById.values()].filter((zone) => depths.has(zone.level));
}

export function displayZoneName(zone: TerritoryZone): string {
  return zone.localName ?? zone.name ?? String(zone.properties?.name ?? zone.id);
}

export function searchAliasesForZone(
  index: NationalSearchIndex | undefined,
  zoneId: string
): readonly string[] {
  return index?.searchAliasesById.get(zoneId) ?? [];
}

export function normalizeSearchText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/İ/g, "i")
    .toLocaleLowerCase("tr")
    .trim();
}

function readNonEmptyString(value: unknown): string | undefined {
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed : undefined;
}
