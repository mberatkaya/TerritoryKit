import type {
  TerritoryDataset,
  TerritorySemanticAdminType,
  TerritorySourceClass,
  TerritoryZone
} from "../src/index.js";

type Adm3Kind = "neighbourhood" | "village" | "generated-zone";

interface Adm3FixtureOptions {
  id: string;
  name: string;
  semanticType: Adm3Kind;
  sourceClass: TerritorySourceClass;
  west: number;
  east: number;
  sourceNativeId?: string;
  stableId?: string;
  official?: boolean;
  generated?: boolean;
  omitProvenance?: boolean;
  omitAlgorithmVersion?: boolean;
  boundarySourceClass?: string;
  boundaryKind?: string;
  confidence?: string;
  administrative?: boolean;
  licenseState?: string;
  omitBoundarySourceClass?: boolean;
  omitSourceSnapshotChecksum?: boolean;
  omitGeometryHash?: boolean;
  coverageStatus?: string;
  semanticReviewStatus?: string;
  provinceCode?: string;
  districtCode?: string;
  parentId?: string;
  parentLevel?: number;
  localTypeName?: string;
  multipolygon?: boolean;
}

const DATASET_ID = "territory-kit-tr-v2-fixture";
const ADM0_ID = "tr";
const ADM1_ID = "tr:adm1:34";
const ADM2_ID = "tr:adm2:34-003";

export function createTurkeyV2Fixture(
  adm3Zones: readonly TerritoryZone[] = [
    createAdm3Zone({
      id: "tr:adm3:34-003-official-100",
      name: "İstiklal",
      semanticType: "neighbourhood",
      sourceClass: "official",
      sourceNativeId: "100",
      west: 28.94,
      east: 28.96
    })
  ],
  options: { parentLevel?: number; cycle?: boolean } = {}
): TerritoryDataset {
  const parentLevel = options.parentLevel ?? 2;
  const adm0 = createZone({
    id: ADM0_ID,
    level: 0,
    semanticType: "country",
    name: "Turkiye",
    west: 28.8,
    south: 40.9,
    east: 29.2,
    north: 41.2,
    childIds: [ADM1_ID],
    territory: {
      adminLevel: "ADM0",
      sourceAdminLevel: "ADM0",
      semanticType: "country",
      localType: "country",
      localTypeName: "Ülke",
      hierarchyDepth: 0,
      countryCode: "TR",
      semanticReviewStatus: "reviewed",
      coverageStatus: "verified"
    }
  });
  const adm1 = createZone({
    id: ADM1_ID,
    level: 1,
    semanticType: "province",
    name: "Istanbul",
    west: 28.85,
    south: 40.95,
    east: 29.15,
    north: 41.15,
    parentId: options.cycle ? ADM2_ID : ADM0_ID,
    childIds: [ADM2_ID],
    territory: {
      adminLevel: "ADM1",
      sourceAdminLevel: "ADM1",
      semanticType: "province",
      localType: "province",
      localTypeName: "İl",
      hierarchyDepth: 1,
      parentId: ADM0_ID,
      countryCode: "TR",
      provinceCode: "34",
      semanticReviewStatus: "reviewed",
      coverageStatus: "verified"
    }
  });
  const adm2 = createZone({
    id: ADM2_ID,
    level: parentLevel,
    semanticType: parentLevel === 2 ? "district" : "province",
    name: "Fatih",
    west: 28.9,
    south: 41,
    east: 29.05,
    north: 41.08,
    parentId: ADM1_ID,
    childIds: adm3Zones.map((zone) => zone.id),
    territory: {
      adminLevel: parentLevel === 2 ? "ADM2" : "ADM1",
      sourceAdminLevel: parentLevel === 2 ? "ADM2" : "ADM1",
      semanticType: parentLevel === 2 ? "district" : "province",
      localType: parentLevel === 2 ? "district" : "province",
      localTypeName: parentLevel === 2 ? "İlçe" : "İl",
      hierarchyDepth: parentLevel,
      parentId: ADM1_ID,
      countryCode: "TR",
      provinceCode: "34",
      districtCode: "003",
      semanticReviewStatus: "reviewed",
      coverageStatus: "verified"
    }
  });

  return {
    manifest: {
      datasetId: DATASET_ID,
      datasetVersion: "1.1.0",
      schemaVersion: "territory-schema@1",
      sourceDate: "2026-08-13",
      buildDate: "2026-08-13T00:00:00.000Z",
      geometryHash: "turkey-v2-fixture",
      adminLevels: ["ADM0", "ADM1", "ADM2", "ADM3"],
      countryCodes: ["TR"],
      license: "mixed",
      attribution: "Synthetic Turkey V2 fixture",
      sourceProvider: "fixture",
      name: "Turkey V2 fixture"
    },
    zones: [adm0, adm1, adm2, ...adm3Zones]
  };
}

export function createAdm3Zone(options: Adm3FixtureOptions): TerritoryZone {
  const parentId = options.parentId ?? ADM2_ID;
  const provinceCode = options.provinceCode ?? "34";
  const districtCode = options.districtCode ?? "003";
  const sourceNativeId =
    options.sourceNativeId ??
    (options.sourceClass === "generated" ? options.id : `${options.sourceClass}-native`);
  const source: Record<string, string | undefined> = options.omitProvenance
    ? {}
    : {
        provider: options.sourceClass === "osm" ? "openstreetmap" : "fixture-official-provider",
        sourceClass: options.sourceClass,
        boundarySourceClass: boundarySourceClassFor(options.sourceClass),
        providerId: options.sourceClass === "osm" ? "openstreetmap" : "fixture-official-provider",
        providerName: options.sourceClass === "osm" ? "OpenStreetMap" : "Fixture official source",
        sourceDatasetId: options.sourceClass === "osm" ? "openstreetmap" : "fixture-official",
        sourceId: sourceNativeId,
        sourceNativeId,
        sourceUrl:
          options.sourceClass === "osm"
            ? "https://www.openstreetmap.org/"
            : "https://data.example.test/tr/adm3",
        sourceVersion: "fixture-v1",
        ...(options.omitSourceSnapshotChecksum
          ? {}
          : { sourceSnapshotChecksum: "sha256:fixture-source-snapshot" }),
        licenseState: "approved",
        sourceDate: "2026-08-01",
        license: options.sourceClass === "osm" ? "ODbL-1.0" : "CC BY 4.0",
        attribution: options.sourceClass === "osm" ? "OpenStreetMap contributors" : "Fixture"
      };
  const generatedZone =
    options.sourceClass === "generated"
      ? {
          algorithm: "deterministic-clipped-grid-tessellation",
          ...(options.omitAlgorithmVersion
            ? {}
            : { algorithmVersion: "tr-adm3-generated-zone-v1" }),
          seed: "fixture-seed",
          generationSeed: "fixture-seed",
          localKey: sourceNativeId
        }
      : undefined;

  return createZone({
    id: options.id,
    level: 3,
    semanticType: options.semanticType,
    name: options.name,
    west: options.west,
    south: 41.01,
    east: options.east,
    north: 41.07,
    parentId,
    territory: {
      adminLevel: "ADM3",
      sourceAdminLevel: "ADM3",
      semanticType: options.semanticType,
      localType: options.semanticType,
      localTypeName:
        options.localTypeName ??
        (options.semanticType === "village"
          ? "Köy"
          : options.semanticType === "generated-zone"
            ? "Generated game zone"
            : "Mahalle"),
      hierarchyDepth: 3,
      parentId,
      countryCode: "TR",
      provinceCode,
      districtCode,
      sourceClass: options.sourceClass,
      ...(options.omitBoundarySourceClass
        ? {}
        : {
            boundarySourceClass:
              options.boundarySourceClass ?? boundarySourceClassFor(options.sourceClass)
          }),
      boundaryKind: options.boundaryKind ?? boundaryKindFor(options.sourceClass),
      confidence: options.confidence ?? confidenceFor(options.sourceClass),
      administrative:
        options.administrative ??
        (options.sourceClass === "official" && options.boundarySourceClass !== "smart-derived"),
      providerId: source.providerId,
      providerName: source.providerName,
      sourceProvider: source.provider,
      sourceId: source.sourceId,
      sourceDatasetId: source.sourceDatasetId,
      sourceNativeId,
      sourceDate: source.sourceDate,
      sourceVersion: source.sourceVersion,
      sourceUrl: source.sourceUrl,
      ...(options.omitSourceSnapshotChecksum
        ? {}
        : { sourceSnapshotChecksum: source.sourceSnapshotChecksum }),
      licenseState: options.licenseState ?? source.licenseState,
      license: source.license,
      attribution: source.attribution,
      official: options.official ?? options.sourceClass === "official",
      generated: options.generated ?? options.sourceClass === "generated",
      ...(generatedZone?.algorithmVersion
        ? { algorithmVersion: generatedZone.algorithmVersion }
        : {}),
      ...(generatedZone?.generationSeed ? { generationSeed: generatedZone.generationSeed } : {}),
      semanticReviewStatus:
        options.semanticReviewStatus ??
        (options.sourceClass === "generated" ? "not-applicable" : "reviewed"),
      coverageStatus:
        options.coverageStatus ?? (options.sourceClass === "generated" ? "generated" : "verified"),
      stableId: options.stableId ?? options.id,
      ...(options.omitGeometryHash ? {} : { geometryHash: `sha256:${options.id}` }),
      source,
      ...(generatedZone ? { generatedZone } : {})
    },
    multipolygon: options.multipolygon
  });
}

function boundarySourceClassFor(sourceClass: TerritorySourceClass): string {
  if (sourceClass === "official") {
    return "official-local";
  }

  if (sourceClass === "osm") {
    return "osm-administrative";
  }

  return "smart-derived";
}

function boundaryKindFor(sourceClass: TerritorySourceClass): string {
  return sourceClass === "generated" ? "estimated" : "administrative";
}

function confidenceFor(sourceClass: TerritorySourceClass): string {
  if (sourceClass === "official") {
    return "authoritative";
  }

  if (sourceClass === "osm") {
    return "high";
  }

  return "medium";
}

export function createLegacySchemaV1Dataset(): TerritoryDataset {
  return {
    manifest: {
      datasetId: "legacy-tr-schema-v1",
      datasetVersion: "0.1.0",
      schemaVersion: "territory-schema@1",
      sourceDate: "legacy",
      geometryHash: "legacy"
    },
    zones: [
      createZone({
        id: "legacy-root",
        datasetId: "legacy-tr-schema-v1",
        level: 0,
        semanticType: "country",
        name: "Legacy",
        west: 0,
        south: 0,
        east: 10,
        north: 10,
        childIds: ["legacy-child"],
        territory: {}
      }),
      createZone({
        id: "legacy-child",
        datasetId: "legacy-tr-schema-v1",
        level: 1,
        semanticType: "district",
        name: "Legacy child",
        west: 0,
        south: 0,
        east: 5,
        north: 5,
        parentId: "legacy-root",
        territory: {}
      })
    ]
  };
}

export function createGaziantepPilotCompatibilityFixture(): TerritoryDataset {
  return createTurkeyV2Fixture([
    createAdm3Zone({
      id: "tr:adm3:gaziantep-legacy-compatible",
      name: "Gaziantep Pilot Mahallesi",
      semanticType: "neighbourhood",
      sourceClass: "official",
      sourceNativeId: "KIMLIKNO-1",
      west: 28.94,
      east: 28.96
    })
  ]);
}

function createZone(options: {
  id: string;
  datasetId?: string;
  level: number;
  semanticType: TerritorySemanticAdminType;
  name: string;
  west: number;
  south: number;
  east: number;
  north: number;
  parentId?: string;
  childIds?: string[];
  territory: Record<string, unknown>;
  multipolygon?: boolean | undefined;
}): TerritoryZone {
  const geometry = options.multipolygon
    ? {
        type: "MultiPolygon" as const,
        coordinates: [
          [
            [
              [options.west, options.south],
              [(options.west + options.east) / 2, options.south],
              [(options.west + options.east) / 2, options.north],
              [options.west, options.north],
              [options.west, options.south]
            ]
          ],
          [
            [
              [(options.west + options.east) / 2, options.south],
              [options.east, options.south],
              [options.east, options.north],
              [(options.west + options.east) / 2, options.north],
              [(options.west + options.east) / 2, options.south]
            ]
          ]
        ]
      }
    : {
        type: "Polygon" as const,
        coordinates: [
          [
            [options.west, options.south],
            [options.east, options.south],
            [options.east, options.north],
            [options.west, options.north],
            [options.west, options.south]
          ]
        ]
      };

  return {
    id: options.id,
    datasetId: options.datasetId ?? DATASET_ID,
    countryCode: "TR",
    level: options.level,
    sourceAdminLevel: `ADM${options.level}`,
    semanticType: options.semanticType,
    name: options.name,
    ...(options.parentId ? { parentId: options.parentId } : {}),
    ...(options.childIds ? { childIds: options.childIds } : {}),
    neighborIds: [],
    geometry,
    center: [(options.west + options.east) / 2, (options.south + options.north) / 2],
    bbox: [options.west, options.south, options.east, options.north],
    properties: {
      territory: options.territory
    }
  };
}
