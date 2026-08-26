import type {
  TerritoryAdminLevel,
  TerritoryDataset,
  TerritorySemanticAdminType,
  TerritoryZone
} from "@territory-kit/dataset";
import { isTerritoryError } from "@territory-kit/dataset";
import { territoryZonesToFeatureCollection } from "@territory-kit/adapter-core";
import type { TerritoryRenderSource, TerritoryRendererAdapter } from "@territory-kit/adapter-core";

export interface SyntheticGridDatasetOptions {
  datasetId?: string;
  rows: number;
  columns: number;
  level?: number;
  originLng?: number;
  originLat?: number;
  cellSize?: number;
  withNeighbors?: boolean;
}

export interface TerritoryRendererAdapterContractHarness<TTarget> {
  readonly name: string;
  readonly sourceId: string;
  createAdapter(): TerritoryRendererAdapter<TTarget>;
  createTarget(): TTarget;
  readSourceUpdateCount?(target: TTarget): number;
  readListenerCount?(target: TTarget): number;
  readLayerCount?(target: TTarget): number;
  emitClick?(target: TTarget, territoryId: string): void;
  emitHover?(target: TTarget, territoryId: string): void;
}

export interface TerritoryRendererAdapterContractResult {
  readonly name: string;
  readonly lifecycle: readonly string[];
  readonly beforeAttachErrorCode?: string;
  readonly unsupportedVectorTileErrorCode?: string;
  readonly sourceUpdateCount?: number;
  readonly listenerCountAfterDetach?: number;
  readonly layerCountAfterDetach?: number;
}

export async function exerciseTerritoryRendererAdapterContract<TTarget>(
  harness: TerritoryRendererAdapterContractHarness<TTarget>
): Promise<TerritoryRendererAdapterContractResult> {
  const dataset = createSyntheticGridDataset({
    datasetId: `renderer-contract-${harness.name}`,
    rows: 2,
    columns: 2,
    level: 0,
    cellSize: 1
  });
  const source: TerritoryRenderSource = {
    id: harness.sourceId,
    type: "geojson",
    data: territoryZonesToFeatureCollection(dataset.zones)
  };
  const adapter = harness.createAdapter();
  const target = harness.createTarget();
  const lifecycle: string[] = [adapter.lifecycleState];
  let beforeAttachErrorCode: string | undefined;
  let unsupportedVectorTileErrorCode: string | undefined;

  try {
    await adapter.setSource(source, { requestId: "contract-before-attach", revision: 0 });
  } catch (error) {
    beforeAttachErrorCode = isTerritoryError(error) ? error.code : "UNKNOWN";
  }

  await adapter.attach(target);
  lifecycle.push(adapter.lifecycleState);

  await adapter.setSource(source, {
    requestId: "contract-update",
    revision: 1,
    signal: new AbortController().signal
  });
  const hoverTerritoryId = dataset.zones[1]?.id;
  await adapter.updateState({
    selectedTerritoryIds: [dataset.zones[0]?.id ?? ""],
    ...(hoverTerritoryId ? { hoverTerritoryId } : {})
  });
  await adapter.updateTheme({
    fillColor: "#2563eb",
    lineColor: "#111827",
    lineWidth: 2
  });

  harness.emitHover?.(target, dataset.zones[0]?.id ?? "");
  harness.emitClick?.(target, dataset.zones[0]?.id ?? "");

  if (adapter.capabilities.vectorTiles !== true) {
    try {
      await adapter.setSource(
        {
          id: harness.sourceId,
          type: "vector-tiles",
          tiles: ["https://tiles.example.test/{z}/{x}/{y}.mvt"]
        },
        { requestId: "contract-vector", revision: 2 }
      );
    } catch (error) {
      unsupportedVectorTileErrorCode = isTerritoryError(error) ? error.code : "UNKNOWN";
    }
  }

  await adapter.detach();
  lifecycle.push(adapter.lifecycleState);

  return {
    name: harness.name,
    lifecycle,
    ...(beforeAttachErrorCode ? { beforeAttachErrorCode } : {}),
    ...(unsupportedVectorTileErrorCode ? { unsupportedVectorTileErrorCode } : {}),
    ...(harness.readSourceUpdateCount
      ? { sourceUpdateCount: harness.readSourceUpdateCount(target) }
      : {}),
    ...(harness.readListenerCount
      ? { listenerCountAfterDetach: harness.readListenerCount(target) }
      : {}),
    ...(harness.readLayerCount ? { layerCountAfterDetach: harness.readLayerCount(target) } : {})
  };
}

export function createSquareZone(options: {
  id: string;
  datasetId?: string;
  countryCode?: string;
  sourceAdminLevel?: TerritoryAdminLevel;
  semanticType?: TerritorySemanticAdminType;
  name?: string;
  localName?: string;
  level: number;
  west: number;
  south: number;
  east: number;
  north: number;
  parentId?: string;
  childIds?: string[];
  neighborIds?: string[];
  properties?: Record<string, unknown>;
}): TerritoryZone {
  const datasetId = options.datasetId ?? "territorykit-sample";

  return {
    id: options.id,
    datasetId,
    ...(options.countryCode ? { countryCode: options.countryCode } : {}),
    level: options.level,
    ...(options.sourceAdminLevel ? { sourceAdminLevel: options.sourceAdminLevel } : {}),
    ...(options.semanticType ? { semanticType: options.semanticType } : {}),
    ...(options.name ? { name: options.name } : {}),
    ...(options.localName ? { localName: options.localName } : {}),
    ...(options.parentId ? { parentId: options.parentId } : {}),
    ...(options.childIds ? { childIds: options.childIds } : {}),
    neighborIds: options.neighborIds ?? [],
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [options.west, options.south],
          [options.east, options.south],
          [options.east, options.north],
          [options.west, options.north],
          [options.west, options.south]
        ]
      ]
    },
    center: [(options.west + options.east) / 2, (options.south + options.north) / 2],
    bbox: [options.west, options.south, options.east, options.north],
    properties: options.properties ?? {}
  };
}

export function createTurkeyAdm3DemoDataset(): TerritoryDataset {
  const datasetId = "territorykit-tr-adm3-demo";
  const source = {
    provider: "synthetic-demo",
    providerId: "synthetic-demo",
    providerName: "TerritoryKit synthetic demo fixture",
    sourceClass: "generated",
    boundarySourceClass: "synthetic-test",
    sourceDatasetId: datasetId,
    sourceId: "synthetic-tr-adm3-demo-v1",
    sourceNativeId: "synthetic-tr-adm3-demo-v1",
    sourceDate: "2026-01-01",
    sourceVersion: "synthetic-tr-adm3-demo-v1",
    sourceSnapshotChecksum: "sha256:synthetic-tr-adm3-demo-v1",
    importedAt: "2026-01-01T00:00:00.000Z",
    licenseState: "approved",
    license: "Apache-2.0",
    attribution: "Synthetic TerritoryKit Turkey ADM3 demonstration fixture"
  };
  const territory = (input: {
    adminLevel: TerritoryAdminLevel;
    semanticType: TerritorySemanticAdminType;
    localType: string;
    localTypeName?: string;
    parentId?: string;
    coverageStatus?: "verified" | "partial";
  }) => ({
    adminLevel: input.adminLevel,
    sourceAdminLevel: input.adminLevel,
    semanticType: input.semanticType,
    localType: input.localType,
    ...(input.localTypeName ? { localTypeName: input.localTypeName } : {}),
    hierarchyDepth: Number(input.adminLevel.slice(3)),
    ...(input.parentId ? { parentId: input.parentId } : {}),
    boundaryKind: "estimated",
    boundarySourceClass: "synthetic-test",
    confidence: "low",
    administrative: false,
    providerId: source.providerId,
    providerName: source.providerName,
    sourceClass: source.sourceClass,
    sourceProvider: source.provider,
    sourceId: source.sourceId,
    sourceDatasetId: source.sourceDatasetId,
    sourceNativeId: source.sourceNativeId,
    sourceDate: source.sourceDate,
    sourceVersion: source.sourceVersion,
    sourceSnapshotChecksum: source.sourceSnapshotChecksum,
    licenseState: source.licenseState,
    license: source.license,
    attribution: source.attribution,
    official: false,
    generated: true,
    geometryHash: `sha256:synthetic:${input.adminLevel}:${input.parentId ?? "root"}:${input.localType}`,
    semanticReviewStatus: "reviewed",
    coverageStatus: input.coverageStatus ?? "verified",
    source
  });

  return {
    manifest: {
      datasetId,
      datasetVersion: "0.0.0-demo",
      schemaVersion: "territory-schema@1",
      sourceDate: "synthetic-demo",
      geometryHash: "synthetic-tr-adm3-demo-v1",
      adminLevels: ["ADM0", "ADM1", "ADM2", "ADM3"],
      license: "Apache-2.0",
      attribution: source.attribution,
      name: "Synthetic Turkey ADM3 Demo",
      description:
        "Synthetic demonstration fixture for Turkey ADM3 neighbourhood semantics; not official or nationwide coverage.",
      sourceProvider: "synthetic-demo"
    },
    zones: [
      createSquareZone({
        id: "tr",
        datasetId,
        countryCode: "TR",
        sourceAdminLevel: "ADM0",
        semanticType: "country",
        name: "Turkiye",
        localName: "Türkiye",
        level: 0,
        west: 28.8,
        south: 40.9,
        east: 29.2,
        north: 41.2,
        childIds: ["tr:adm1:istanbul"],
        properties: {
          name: "Turkiye",
          territory: territory({
            adminLevel: "ADM0",
            semanticType: "country",
            localType: "country"
          })
        }
      }),
      createSquareZone({
        id: "tr:adm1:istanbul",
        datasetId,
        countryCode: "TR",
        sourceAdminLevel: "ADM1",
        semanticType: "province",
        name: "Istanbul",
        localName: "İstanbul",
        level: 1,
        west: 28.9,
        south: 40.95,
        east: 29.1,
        north: 41.1,
        parentId: "tr",
        childIds: ["tr:adm2:fatih"],
        properties: {
          name: "Istanbul",
          territory: territory({
            adminLevel: "ADM1",
            semanticType: "province",
            localType: "province",
            localTypeName: "İl",
            parentId: "tr"
          })
        }
      }),
      createSquareZone({
        id: "tr:adm2:fatih",
        datasetId,
        countryCode: "TR",
        sourceAdminLevel: "ADM2",
        semanticType: "district",
        name: "Fatih",
        level: 2,
        west: 28.94,
        south: 41,
        east: 29,
        north: 41.06,
        parentId: "tr:adm1:istanbul",
        childIds: [
          "tr:adm3:demo-neighbourhood-a",
          "tr:adm3:demo-neighbourhood-b",
          "tr:adm3:demo-neighbourhood-c"
        ],
        properties: {
          name: "Fatih",
          territory: territory({
            adminLevel: "ADM2",
            semanticType: "district",
            localType: "district",
            localTypeName: "İlçe",
            parentId: "tr:adm1:istanbul"
          })
        }
      }),
      createSquareZone({
        id: "tr:adm3:demo-neighbourhood-a",
        datasetId,
        countryCode: "TR",
        sourceAdminLevel: "ADM3",
        semanticType: "neighbourhood",
        name: "Demo Neighbourhood A",
        level: 3,
        west: 28.94,
        south: 41,
        east: 28.96,
        north: 41.06,
        parentId: "tr:adm2:fatih",
        neighborIds: ["tr:adm3:demo-neighbourhood-b"],
        properties: {
          name: "Demo Neighbourhood A",
          territory: territory({
            adminLevel: "ADM3",
            semanticType: "neighbourhood",
            localType: "neighbourhood",
            localTypeName: "Mahalle",
            parentId: "tr:adm2:fatih",
            coverageStatus: "partial"
          })
        }
      }),
      createSquareZone({
        id: "tr:adm3:demo-neighbourhood-b",
        datasetId,
        countryCode: "TR",
        sourceAdminLevel: "ADM3",
        semanticType: "neighbourhood",
        name: "Demo Neighbourhood B",
        level: 3,
        west: 28.96,
        south: 41,
        east: 28.98,
        north: 41.06,
        parentId: "tr:adm2:fatih",
        neighborIds: ["tr:adm3:demo-neighbourhood-a", "tr:adm3:demo-neighbourhood-c"],
        properties: {
          name: "Demo Neighbourhood B",
          territory: territory({
            adminLevel: "ADM3",
            semanticType: "neighbourhood",
            localType: "neighbourhood",
            localTypeName: "Mahalle",
            parentId: "tr:adm2:fatih",
            coverageStatus: "partial"
          })
        }
      }),
      createSquareZone({
        id: "tr:adm3:demo-neighbourhood-c",
        datasetId,
        countryCode: "TR",
        sourceAdminLevel: "ADM3",
        semanticType: "neighbourhood",
        name: "Demo Neighbourhood C",
        level: 3,
        west: 28.98,
        south: 41,
        east: 29,
        north: 41.06,
        parentId: "tr:adm2:fatih",
        neighborIds: ["tr:adm3:demo-neighbourhood-b"],
        properties: {
          name: "Demo Neighbourhood C",
          territory: territory({
            adminLevel: "ADM3",
            semanticType: "neighbourhood",
            localType: "neighbourhood",
            localTypeName: "Mahalle",
            parentId: "tr:adm2:fatih",
            coverageStatus: "partial"
          })
        }
      })
    ]
  };
}

export function createSampleTerritoryDataset(): TerritoryDataset {
  return {
    manifest: {
      datasetId: "territorykit-sample",
      datasetVersion: "0.1.0-alpha.1",
      schemaVersion: "territory-schema@1",
      sourceDate: "2026-07",
      geometryHash: "sample-fixture-v1",
      license: "Apache-2.0",
      name: "TerritoryKit Sample"
    },
    zones: [
      createSquareZone({
        id: "world:europe",
        level: 0,
        west: 20,
        south: 35,
        east: 45,
        north: 43,
        childIds: ["tr"]
      }),
      createSquareZone({
        id: "tr",
        level: 1,
        west: 25,
        south: 36,
        east: 45,
        north: 42,
        parentId: "world:europe",
        childIds: ["tr:34"],
        properties: { name: "Turkiye" }
      }),
      createSquareZone({
        id: "tr:34",
        level: 2,
        west: 28,
        south: 40,
        east: 30,
        north: 42,
        parentId: "tr",
        childIds: ["tr:34:fatih", "tr:34:kadikoy"],
        properties: { name: "Istanbul" }
      }),
      createSquareZone({
        id: "tr:34:fatih",
        level: 3,
        west: 28.93,
        south: 41,
        east: 29,
        north: 41.05,
        parentId: "tr:34",
        neighborIds: ["tr:34:kadikoy"],
        properties: { name: "Fatih" }
      }),
      createSquareZone({
        id: "tr:34:kadikoy",
        level: 3,
        west: 29,
        south: 40.97,
        east: 29.08,
        north: 41.02,
        parentId: "tr:34",
        neighborIds: ["tr:34:fatih"],
        properties: { name: "Kadikoy" }
      })
    ]
  };
}

export function createSyntheticGridDataset(options: SyntheticGridDatasetOptions): TerritoryDataset {
  const datasetId = options.datasetId ?? `synthetic-grid-${options.rows}x${options.columns}`;
  const level = options.level ?? 0;
  const originLng = options.originLng ?? 0;
  const originLat = options.originLat ?? 0;
  const cellSize = options.cellSize ?? 0.01;
  const zones: TerritoryZone[] = [];

  for (let row = 0; row < options.rows; row += 1) {
    for (let column = 0; column < options.columns; column += 1) {
      const id = `z:${row}:${column}`;
      const west = originLng + column * cellSize;
      const south = originLat + row * cellSize;
      const east = west + cellSize;
      const north = south + cellSize;

      zones.push(
        createSquareZone({
          id,
          datasetId,
          level,
          west,
          south,
          east,
          north,
          neighborIds: options.withNeighbors
            ? getGridNeighborIds(row, column, options.rows, options.columns)
            : [],
          properties: { row, column }
        })
      );
    }
  }

  return {
    manifest: {
      datasetId,
      datasetVersion: "0.0.0-synthetic",
      schemaVersion: "territory-schema@1",
      sourceDate: "synthetic",
      geometryHash: `${options.rows}x${options.columns}:${cellSize}`,
      license: "Apache-2.0",
      name: `Synthetic grid ${options.rows}x${options.columns}`
    },
    zones
  };
}

function getGridNeighborIds(row: number, column: number, rows: number, columns: number): string[] {
  const neighbors: string[] = [];

  if (row > 0) {
    neighbors.push(`z:${row - 1}:${column}`);
  }

  if (row < rows - 1) {
    neighbors.push(`z:${row + 1}:${column}`);
  }

  if (column > 0) {
    neighbors.push(`z:${row}:${column - 1}`);
  }

  if (column < columns - 1) {
    neighbors.push(`z:${row}:${column + 1}`);
  }

  return neighbors.sort();
}
