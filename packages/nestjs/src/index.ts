import {
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Module,
  Optional,
  Post,
  Query,
  Res
} from "@nestjs/common";
import type { DynamicModule, Provider } from "@nestjs/common";
import { computeGeometryBBox, computeGeometryCenter } from "@territory-kit/dataset";
import type { TerritoryDataset, TerritoryGeometry, TerritoryZone } from "@territory-kit/dataset";
import { createTerritoryEngine } from "@territory-kit/core";
import type {
  LatLng,
  TerritoryBounds,
  TerritoryEngine,
  TerritoryEngineOptions,
  ZoomLevelStrategy
} from "@territory-kit/core";
import { ApiBody, ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";

export const TERRITORY_KIT_OPTIONS = Symbol("TERRITORY_KIT_OPTIONS");
export const TERRITORY_KIT_ENGINE = Symbol("TERRITORY_KIT_ENGINE");
export const TERRITORY_KIT_REPOSITORY = Symbol("TERRITORY_KIT_REPOSITORY");

export interface TerritoryKitModuleOptions {
  dataset: TerritoryDataset;
  levelStrategy?: ZoomLevelStrategy;
  repository?: TerritoryRepository;
}

export interface TerritoryViewportRequest extends TerritoryBounds {
  level?: number;
  zoom?: number;
}

export interface TerritoryLocateRequest {
  coordinate: LatLng;
  level?: number;
}

export interface TerritoryViewportResponse {
  zones: TerritoryZone[];
  cacheKey: string;
}

export interface TerritoryLocateResponse {
  zoneId: string | null;
}

export interface TerritoryRepository {
  findVisibleZones(request: TerritoryViewportRequest): Promise<TerritoryZone[]>;
  locateZone(request: TerritoryLocateRequest): Promise<string | null>;
}

export class TerritoryViewportQueryDto {
  west!: string;
  south!: string;
  east!: string;
  north!: string;
  level?: string;
  zoom?: string;
}

export class TerritoryLocateBodyDto {
  lat!: number;
  lng!: number;
  level?: number;
}

export interface PostgisQueryClient {
  query<Row>(sql: string, values: unknown[]): Promise<{ rows: Row[] }>;
}

export interface PostgisRepositoryOptions {
  datasetId: string;
  defaultLevel?: number;
}

interface PostgisZoneRow {
  id: string;
  dataset_id: string;
  level: number;
  parent_id: string | null;
  child_ids: string[] | null;
  neighbor_ids: string[] | null;
  properties: Record<string, unknown> | null;
  geometry: TerritoryGeometry;
}

interface HeaderResponse {
  setHeader(name: string, value: string): void;
}

@ApiTags("territories")
@Controller()
export class TerritoryKitController {
  constructor(
    @Inject(TERRITORY_KIT_ENGINE) private readonly engine: TerritoryEngine,
    @Optional()
    @Inject(TERRITORY_KIT_REPOSITORY)
    private readonly repository?: TerritoryRepository
  ) {}

  @Get("territories")
  @Header("Cache-Control", "public, max-age=30")
  @ApiOperation({ summary: "Return territories intersecting a viewport." })
  @ApiQuery({ name: "west", required: true })
  @ApiQuery({ name: "south", required: true })
  @ApiQuery({ name: "east", required: true })
  @ApiQuery({ name: "north", required: true })
  @ApiQuery({ name: "level", required: false })
  @ApiQuery({ name: "zoom", required: false })
  @ApiResponse({ status: 200, description: "Viewport territory response." })
  async getTerritories(
    @Query() query: TerritoryViewportQueryDto,
    @Res({ passthrough: true }) response?: HeaderResponse
  ): Promise<TerritoryViewportResponse> {
    const request = parseViewportQuery(query);
    const cacheKey = this.engine.getViewportCacheKey({
      bounds: request,
      ...(request.level === undefined ? {} : { level: request.level }),
      ...(request.zoom === undefined ? {} : { zoom: request.zoom })
    });
    const zones = this.repository
      ? await this.repository.findVisibleZones(request)
      : resolveInMemoryViewport(this.engine, request);

    response?.setHeader("ETag", `"${cacheKey}"`);

    return { zones, cacheKey };
  }

  @Post("territories/locate")
  @ApiOperation({ summary: "Locate the territory covering a coordinate." })
  @ApiBody({ type: TerritoryLocateBodyDto })
  @ApiResponse({ status: 200, description: "Locate response." })
  async locateTerritory(@Body() body: TerritoryLocateBodyDto): Promise<TerritoryLocateResponse> {
    const request: TerritoryLocateRequest = {
      coordinate: {
        lat: Number(body.lat),
        lng: Number(body.lng)
      },
      ...(body.level === undefined ? {} : { level: Number(body.level) })
    };
    const zoneId = this.repository
      ? await this.repository.locateZone(request)
      : this.engine.latLngToZone(
          request.coordinate,
          request.level === undefined ? {} : { level: request.level }
        );

    return { zoneId };
  }
}

@Module({})
export class TerritoryKitModule {
  static forRoot(options: TerritoryKitModuleOptions): DynamicModule {
    const engineProvider: Provider<TerritoryEngine> = {
      provide: TERRITORY_KIT_ENGINE,
      useFactory: () =>
        createTerritoryEngine({
          dataset: options.dataset,
          ...(options.levelStrategy ? { levelStrategy: options.levelStrategy } : {})
        } satisfies TerritoryEngineOptions)
    };
    const repositoryProvider: Provider<TerritoryRepository>[] = options.repository
      ? [
          {
            provide: TERRITORY_KIT_REPOSITORY,
            useValue: options.repository
          }
        ]
      : [];
    const repositoryExports = options.repository ? [TERRITORY_KIT_REPOSITORY] : [];

    return {
      module: TerritoryKitModule,
      providers: [
        {
          provide: TERRITORY_KIT_OPTIONS,
          useValue: options
        },
        engineProvider,
        ...repositoryProvider
      ],
      controllers: [TerritoryKitController],
      exports: [TERRITORY_KIT_ENGINE, ...repositoryExports]
    };
  }
}

export function createPostgisTerritoryRepository(
  client: PostgisQueryClient,
  options: PostgisRepositoryOptions
): TerritoryRepository {
  return {
    async findVisibleZones(request) {
      const level = request.level ?? options.defaultLevel ?? 0;
      const { rows } = await client.query<PostgisZoneRow>(POSTGIS_VIEWPORT_SQL, [
        options.datasetId,
        level,
        request.west,
        request.south,
        request.east,
        request.north
      ]);

      return rows.map(postgisRowToZone);
    },

    async locateZone(request) {
      const level = request.level ?? options.defaultLevel ?? 0;
      const { rows } = await client.query<{ id: string }>(POSTGIS_LOCATE_SQL, [
        options.datasetId,
        level,
        request.coordinate.lng,
        request.coordinate.lat
      ]);

      return rows[0]?.id ?? null;
    }
  };
}

export const POSTGIS_VIEWPORT_SQL = `
select
  id,
  dataset_id,
  level,
  parent_id,
  child_ids,
  neighbor_ids,
  properties,
  ST_AsGeoJSON(geometry)::json as geometry
from territory_zones
where dataset_id = $1
  and level = $2
  and geometry && ST_MakeEnvelope($3, $4, $5, $6, 4326)
  and ST_Intersects(geometry, ST_MakeEnvelope($3, $4, $5, $6, 4326))
order by id asc;
`;

export const POSTGIS_LOCATE_SQL = `
select id
from territory_zones
where dataset_id = $1
  and level = $2
  and ST_Covers(geometry, ST_SetSRID(ST_MakePoint($3, $4), 4326))
order by id asc
limit 1;
`;

function parseViewportQuery(query: TerritoryViewportQueryDto): TerritoryViewportRequest {
  return {
    west: Number(query.west),
    south: Number(query.south),
    east: Number(query.east),
    north: Number(query.north),
    ...(query.level === undefined ? {} : { level: Number(query.level) }),
    ...(query.zoom === undefined ? {} : { zoom: Number(query.zoom) })
  };
}

function resolveInMemoryViewport(
  engine: TerritoryEngine,
  request: TerritoryViewportRequest
): TerritoryZone[] {
  if (request.zoom !== undefined && request.level === undefined) {
    return engine.getVisibleZones({ bounds: request, zoom: request.zoom });
  }

  return engine.getZonesInBounds(request);
}

function postgisRowToZone(row: PostgisZoneRow): TerritoryZone {
  const geometry = row.geometry;

  return {
    id: row.id,
    datasetId: row.dataset_id,
    level: row.level,
    ...(row.parent_id ? { parentId: row.parent_id } : {}),
    ...(row.child_ids ? { childIds: row.child_ids } : {}),
    neighborIds: row.neighbor_ids ?? [],
    geometry,
    center: computeGeometryCenter(geometry),
    bbox: computeGeometryBBox(geometry),
    properties: row.properties ?? {}
  };
}
