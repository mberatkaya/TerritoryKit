import {
  BadRequestException,
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
import {
  computeLngLatDistanceM,
  computeTerritoryAreaM2,
  computeTerritoryRepresentativePoint,
  createTerritoryEngine,
  createTerritoryIdentity,
  normalizeLongitude
} from "@territory-kit/core";
import type {
  LatLng,
  TerritoryBounds,
  TerritoryEngine,
  TerritoryEngineOptions,
  TerritoryGeometryMetrics,
  TerritoryHierarchy,
  TerritoryRouteInput,
  TerritoryRouteQueryOptions,
  TerritoryRouteQueryResult,
  TerritoryRouteTraversalSegment,
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

export interface TerritoryRouteRequest extends TerritoryRouteQueryOptions {
  route: TerritoryRouteInput;
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
  findAlongRoute?(request: TerritoryRouteRequest): Promise<TerritoryRouteQueryResult>;
}

export interface TerritoryPostgisRepository extends TerritoryRepository {
  ensureSchema(): Promise<void>;
  importDataset(
    dataset: TerritoryDataset,
    options?: PostgisImportOptions
  ): Promise<PostgisImportResult>;
  findAtPoint(request: TerritoryLocateRequest): Promise<TerritoryZone | null>;
  findInBounds(request: TerritoryViewportRequest & { limit?: number }): Promise<TerritoryZone[]>;
  findById(territoryId: string): Promise<TerritoryZone | null>;
  getGeometry(territoryId: string): Promise<TerritoryGeometry | null>;
  getMetrics(territoryId: string): Promise<TerritoryGeometryMetrics | null>;
  getHierarchy(territoryId: string): Promise<TerritoryHierarchy | null>;
  getAdjacentTerritories(territoryId: string): Promise<TerritoryZone[]>;
  findAlongRoute(request: TerritoryRouteRequest): Promise<TerritoryRouteQueryResult>;
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

export class TerritoryRouteBodyDto {
  route!: unknown;
  level?: number;
  levels?: number[];
  mode?: "exact" | "sampled";
}

export interface PostgisQueryClient {
  query<Row>(sql: string, values: unknown[]): Promise<{ rows: Row[] }>;
}

export interface PostgisRepositoryOptions {
  datasetId: string;
  datasetVersion?: string;
  defaultLevel?: number;
  defaultLimit?: number;
  ensureSchema?: boolean;
}

export interface PostgisImportOptions {
  batchSize?: number;
  ensureSchema?: boolean;
}

export interface PostgisImportResult {
  datasetId: string;
  datasetVersion: string;
  geometryHash: string;
  zoneCount: number;
  batchCount: number;
  indexesEnsured: boolean;
}

interface PostgisZoneRow {
  id: string;
  dataset_id: string;
  dataset_version?: string;
  geometry_version?: string;
  level: number;
  source_admin_level?: string | null;
  parent_id: string | null;
  child_ids: string[] | null;
  neighbor_ids: string[] | null;
  properties: Record<string, unknown> | null;
  geometry: TerritoryGeometry;
  bbox?: TerritoryGeometry | null;
  area_m2?: number | null;
  representative_point?: { type: "Point"; coordinates: [number, number] } | null;
}

interface ArrayPostgisZoneRow extends PostgisZoneRow {
  depth: number;
}

interface PostgisRouteRow extends PostgisZoneRow {
  intersection_length_m: number | null;
  route_fraction: number | null;
  intersection_point: { type: "Point"; coordinates: [number, number] } | null;
}

interface PostgisImportRow {
  id: string;
  dataset_id: string;
  dataset_version: string;
  geometry_version: string;
  level: number;
  source_admin_level: string | null;
  parent_id: string | null;
  child_ids: string[];
  neighbor_ids: string[];
  properties: Record<string, unknown>;
  geometry: TerritoryGeometry;
  west: number;
  south: number;
  east: number;
  north: number;
  area_m2: number;
  representative_lng: number;
  representative_lat: number;
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
  @ApiQuery({ description: "Western longitude bound.", name: "west", required: true, type: Number })
  @ApiQuery({
    description: "Southern latitude bound.",
    name: "south",
    required: true,
    type: Number
  })
  @ApiQuery({ description: "Eastern longitude bound.", name: "east", required: true, type: Number })
  @ApiQuery({
    description: "Northern latitude bound.",
    name: "north",
    required: true,
    type: Number
  })
  @ApiQuery({
    description: "Explicit territory level.",
    name: "level",
    required: false,
    type: Number
  })
  @ApiQuery({
    description: "Zoom resolved by the configured level strategy.",
    name: "zoom",
    required: false,
    type: Number
  })
  @ApiResponse({
    status: 200,
    description: "Viewport territory response.",
    schema: {
      type: "object",
      required: ["zones", "cacheKey"],
      properties: {
        zones: {
          type: "array",
          items: { $ref: "#/components/schemas/TerritoryZone" }
        },
        cacheKey: { type: "string" }
      }
    }
  })
  @ApiResponse({ status: 400, description: "Invalid viewport query parameters." })
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
  @ApiResponse({
    status: 200,
    description: "Locate response.",
    schema: {
      type: "object",
      required: ["zoneId"],
      properties: {
        zoneId: {
          nullable: true,
          type: "string"
        }
      }
    }
  })
  @ApiResponse({ status: 400, description: "Invalid coordinate request body." })
  async locateTerritory(@Body() body: TerritoryLocateBodyDto): Promise<TerritoryLocateResponse> {
    const request = parseLocateBody(body);
    const zoneId = this.repository
      ? await this.repository.locateZone(request)
      : this.engine.latLngToZone(
          request.coordinate,
          request.level === undefined ? {} : { level: request.level }
        );

    return { zoneId };
  }

  @Post("territories/route")
  @ApiOperation({ summary: "Return territories intersected by a route LineString." })
  @ApiBody({ type: TerritoryRouteBodyDto })
  @ApiResponse({ status: 200, description: "Route territory response." })
  @ApiResponse({ status: 400, description: "Invalid route request body." })
  async routeTerritories(@Body() body: TerritoryRouteBodyDto): Promise<TerritoryRouteQueryResult> {
    const request = parseRouteBody(body);

    if (this.repository?.findAlongRoute && request.mode !== "sampled") {
      return this.repository.findAlongRoute(request);
    }

    return this.engine.findTerritoriesAlongRoute(request.route, {
      ...(request.level === undefined ? {} : { level: request.level }),
      ...(request.levels === undefined ? {} : { levels: request.levels }),
      ...(request.mode === undefined ? {} : { mode: request.mode })
    });
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
): TerritoryPostgisRepository {
  const datasetVersion = options.datasetVersion ?? null;
  const defaultLimit = options.defaultLimit ?? null;

  return {
    async ensureSchema() {
      await ensurePostgisTerritorySchema(client);
    },

    async importDataset(dataset, importOptions = {}) {
      return importTerritoryDatasetToPostgis(client, dataset, {
        ensureSchema: importOptions.ensureSchema ?? options.ensureSchema ?? true,
        ...(importOptions.batchSize === undefined ? {} : { batchSize: importOptions.batchSize })
      });
    },

    async findAtPoint(request) {
      const level = request.level ?? options.defaultLevel ?? null;
      const { rows } = await client.query<PostgisZoneRow>(POSTGIS_POINT_LOOKUP_SQL, [
        options.datasetId,
        datasetVersion,
        level,
        normalizeLongitude(request.coordinate.lng),
        request.coordinate.lat
      ]);

      return rows[0] ? postgisRowToZone(rows[0]) : null;
    },

    async findInBounds(request) {
      const level = request.level ?? options.defaultLevel ?? null;
      const limit = request.limit ?? defaultLimit;
      const { rows } = await client.query<PostgisZoneRow>(POSTGIS_BOUNDS_SQL, [
        options.datasetId,
        datasetVersion,
        level,
        request.west,
        request.south,
        request.east,
        request.north,
        limit
      ]);

      return rows.map(postgisRowToZone);
    },

    async findAlongRoute(request) {
      const level = request.level ?? options.defaultLevel ?? null;
      const route = normalizeRouteForPostgis(request.route);
      const routeLengthM = computeRouteLengthM(route);

      if (route.length < 2 || routeLengthM <= 0) {
        return {
          mode: "exact",
          routeLengthM,
          territories: [],
          traversal: []
        };
      }

      const { rows } = await client.query<PostgisRouteRow>(POSTGIS_ROUTE_SQL, [
        options.datasetId,
        datasetVersion,
        level,
        JSON.stringify({ type: "LineString", coordinates: route })
      ]);

      return postgisRouteRowsToResult(rows, routeLengthM);
    },

    async findById(territoryId) {
      const { rows } = await client.query<PostgisZoneRow>(POSTGIS_FIND_BY_ID_SQL, [
        options.datasetId,
        datasetVersion,
        territoryId
      ]);

      return rows[0] ? postgisRowToZone(rows[0]) : null;
    },

    async getGeometry(territoryId) {
      return (await this.findById(territoryId))?.geometry ?? null;
    },

    async getMetrics(territoryId) {
      const { rows } = await client.query<PostgisZoneRow>(POSTGIS_FIND_BY_ID_SQL, [
        options.datasetId,
        datasetVersion,
        territoryId
      ]);

      return rows[0] ? postgisRowToMetrics(rows[0]) : null;
    },

    async getHierarchy(territoryId) {
      const { rows } = await client.query<ArrayPostgisZoneRow>(POSTGIS_HIERARCHY_SQL, [
        options.datasetId,
        datasetVersion,
        territoryId
      ]);

      return postgisRowsToHierarchy(rows);
    },

    async getAdjacentTerritories(territoryId) {
      const { rows } = await client.query<PostgisZoneRow>(POSTGIS_ADJACENT_SQL, [
        options.datasetId,
        datasetVersion,
        territoryId
      ]);

      return rows.map(postgisRowToZone);
    },

    async findVisibleZones(request) {
      const level = request.level ?? options.defaultLevel ?? 0;
      return this.findInBounds({ ...request, level });
    },

    async locateZone(request) {
      return (await this.findAtPoint(request))?.id ?? null;
    }
  };
}

export async function ensurePostgisTerritorySchema(client: PostgisQueryClient): Promise<void> {
  await client.query(POSTGIS_SCHEMA_SQL, []);
  await client.query(POSTGIS_INDEX_SQL, []);
}

export async function importTerritoryDatasetToPostgis(
  client: PostgisQueryClient,
  dataset: TerritoryDataset,
  options: PostgisImportOptions = {}
): Promise<PostgisImportResult> {
  const batchSize = options.batchSize ?? 500;
  const rows = dataset.zones.map((zone) => postgisImportRow(dataset, zone));
  let batchCount = 0;
  let indexesEnsured = false;

  await client.query("begin", []);

  try {
    if (options.ensureSchema ?? true) {
      await ensurePostgisTerritorySchema(client);
      indexesEnsured = true;
    }

    await client.query(POSTGIS_DELETE_STALE_VERSION_SQL, [
      dataset.manifest.datasetId,
      dataset.manifest.datasetVersion,
      rows.map((row) => row.id)
    ]);

    for (let start = 0; start < rows.length; start += batchSize) {
      const batch = rows.slice(start, start + batchSize);
      await client.query(POSTGIS_IMPORT_ZONES_SQL, [JSON.stringify(batch)]);
      batchCount += 1;
    }

    await client.query("commit", []);
  } catch (error) {
    await client.query("rollback", []);
    throw error;
  }

  return {
    datasetId: dataset.manifest.datasetId,
    datasetVersion: dataset.manifest.datasetVersion,
    geometryHash: dataset.manifest.geometryHash,
    zoneCount: rows.length,
    batchCount,
    indexesEnsured
  };
}

export const POSTGIS_SCHEMA_SQL = `
create extension if not exists postgis;

create table if not exists territory_zones (
  id text not null,
  dataset_id text not null,
  dataset_version text not null,
  geometry_version text not null,
  level integer not null,
  source_admin_level text,
  parent_id text,
  child_ids text[] not null default '{}',
  neighbor_ids text[] not null default '{}',
  properties jsonb not null default '{}',
  geometry geometry(MultiPolygon, 4326) not null,
  bbox geometry(Polygon, 4326) not null,
  area_m2 double precision not null,
  representative_point geometry(Point, 4326) not null,
  imported_at timestamptz not null default now(),
  primary key (dataset_id, dataset_version, id)
);
`;

export const POSTGIS_INDEX_SQL = `
create index if not exists territory_zones_identity_idx
  on territory_zones (id);

create index if not exists territory_zones_dataset_level_idx
  on territory_zones (dataset_id, dataset_version, level);

create index if not exists territory_zones_parent_idx
  on territory_zones (dataset_id, dataset_version, parent_id);

create index if not exists territory_zones_geometry_gist_idx
  on territory_zones
  using gist (geometry);

create index if not exists territory_zones_bbox_gist_idx
  on territory_zones
  using gist (bbox);
`;

const POSTGIS_ZONE_SELECT = `
  territory_zones.id,
  territory_zones.dataset_id,
  territory_zones.dataset_version,
  territory_zones.geometry_version,
  territory_zones.level,
  territory_zones.source_admin_level,
  territory_zones.parent_id,
  territory_zones.child_ids,
  territory_zones.neighbor_ids,
  territory_zones.properties,
  ST_AsGeoJSON(territory_zones.geometry)::json as geometry,
  ST_AsGeoJSON(territory_zones.bbox)::json as bbox,
  territory_zones.area_m2,
  ST_AsGeoJSON(territory_zones.representative_point)::json as representative_point
`;

export const POSTGIS_BOUNDS_SQL = `
select
${POSTGIS_ZONE_SELECT}
from territory_zones
where territory_zones.dataset_id = $1
  and ($2::text is null or territory_zones.dataset_version = $2)
  and ($3::integer is null or territory_zones.level = $3)
  and territory_zones.bbox && ST_MakeEnvelope($4, $5, $6, $7, 4326)
  and territory_zones.geometry && ST_MakeEnvelope($4, $5, $6, $7, 4326)
  and ST_Intersects(territory_zones.geometry, ST_MakeEnvelope($4, $5, $6, $7, 4326))
order by territory_zones.level asc, territory_zones.id asc
limit coalesce($8::integer, 2147483647);
`;

export const POSTGIS_POINT_LOOKUP_SQL = `
select
${POSTGIS_ZONE_SELECT}
from territory_zones
where territory_zones.dataset_id = $1
  and ($2::text is null or territory_zones.dataset_version = $2)
  and ($3::integer is null or territory_zones.level = $3)
  and territory_zones.geometry && ST_SetSRID(ST_MakePoint($4, $5), 4326)
  and ST_Covers(territory_zones.geometry, ST_SetSRID(ST_MakePoint($4, $5), 4326))
order by territory_zones.level desc, territory_zones.id asc
limit 1;
`;

export const POSTGIS_ROUTE_SQL = `
with route as (
  select ST_SetSRID(ST_GeomFromGeoJSON($4::text), 4326)::geometry(LineString, 4326) as geometry
),
matches as (
  select
${POSTGIS_ZONE_SELECT},
    ST_Length(ST_Transform(ST_Intersection(territory_zones.geometry, route.geometry), 3857)) as intersection_length_m,
    ST_LineLocatePoint(
      route.geometry,
      ST_ClosestPoint(route.geometry, territory_zones.geometry)
    ) as route_fraction,
    ST_AsGeoJSON(ST_ClosestPoint(route.geometry, territory_zones.geometry))::json as intersection_point
  from territory_zones
  cross join route
  where territory_zones.dataset_id = $1
    and ($2::text is null or territory_zones.dataset_version = $2)
    and ($3::integer is null or territory_zones.level = $3)
    and territory_zones.geometry && ST_Envelope(route.geometry)
    and ST_Intersects(territory_zones.geometry, route.geometry)
)
select *
from matches
order by route_fraction asc, level asc, id asc;
`;

export const POSTGIS_FIND_BY_ID_SQL = `
select
${POSTGIS_ZONE_SELECT}
from territory_zones
where territory_zones.dataset_id = $1
  and ($2::text is null or territory_zones.dataset_version = $2)
  and territory_zones.id = $3
order by territory_zones.dataset_version desc
limit 1;
`;

export const POSTGIS_HIERARCHY_SQL = `
with recursive hierarchy as (
  select
${POSTGIS_ZONE_SELECT},
    0 as depth
  from territory_zones
  where territory_zones.dataset_id = $1
    and ($2::text is null or territory_zones.dataset_version = $2)
    and territory_zones.id = $3
  union all
  select
${POSTGIS_ZONE_SELECT.replaceAll("\n  ", "\n    ")},
    hierarchy.depth + 1 as depth
  from territory_zones
  join hierarchy on territory_zones.id = hierarchy.parent_id
  where territory_zones.dataset_id = $1
    and ($2::text is null or territory_zones.dataset_version = $2)
)
select *
from hierarchy
order by depth asc;
`;

export const POSTGIS_ADJACENT_SQL = `
with source as (
  select neighbor_ids
  from territory_zones
  where dataset_id = $1
    and ($2::text is null or dataset_version = $2)
    and id = $3
  limit 1
)
select
${POSTGIS_ZONE_SELECT}
from territory_zones
join source on territory_zones.id = any(source.neighbor_ids)
where territory_zones.dataset_id = $1
  and ($2::text is null or territory_zones.dataset_version = $2)
order by territory_zones.id asc;
`;

export const POSTGIS_DELETE_STALE_VERSION_SQL = `
delete from territory_zones
where dataset_id = $1
  and dataset_version = $2
  and not (id = any($3::text[]));
`;

export const POSTGIS_IMPORT_ZONES_SQL = `
insert into territory_zones (
  id,
  dataset_id,
  dataset_version,
  geometry_version,
  level,
  source_admin_level,
  parent_id,
  child_ids,
  neighbor_ids,
  properties,
  geometry,
  bbox,
  area_m2,
  representative_point,
  imported_at
)
select
  row.id,
  row.dataset_id,
  row.dataset_version,
  row.geometry_version,
  row.level,
  row.source_admin_level,
  row.parent_id,
  row.child_ids,
  row.neighbor_ids,
  row.properties,
  ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(row.geometry::text), 4326))::geometry(MultiPolygon, 4326),
  ST_MakeEnvelope(row.west, row.south, row.east, row.north, 4326),
  row.area_m2,
  ST_SetSRID(ST_MakePoint(row.representative_lng, row.representative_lat), 4326),
  now()
from jsonb_to_recordset($1::jsonb) as row(
  id text,
  dataset_id text,
  dataset_version text,
  geometry_version text,
  level integer,
  source_admin_level text,
  parent_id text,
  child_ids text[],
  neighbor_ids text[],
  properties jsonb,
  geometry jsonb,
  west double precision,
  south double precision,
  east double precision,
  north double precision,
  area_m2 double precision,
  representative_lng double precision,
  representative_lat double precision
)
on conflict (dataset_id, dataset_version, id) do update set
  geometry_version = excluded.geometry_version,
  level = excluded.level,
  source_admin_level = excluded.source_admin_level,
  parent_id = excluded.parent_id,
  child_ids = excluded.child_ids,
  neighbor_ids = excluded.neighbor_ids,
  properties = excluded.properties,
  geometry = excluded.geometry,
  bbox = excluded.bbox,
  area_m2 = excluded.area_m2,
  representative_point = excluded.representative_point,
  imported_at = now();
`;

export const POSTGIS_VIEWPORT_SQL = POSTGIS_BOUNDS_SQL;
export const POSTGIS_LOCATE_SQL = POSTGIS_POINT_LOOKUP_SQL;

function parseViewportQuery(query: TerritoryViewportQueryDto): TerritoryViewportRequest {
  const west = readFiniteNumber(query.west, "west");
  const south = readFiniteNumber(query.south, "south");
  const east = readFiniteNumber(query.east, "east");
  const north = readFiniteNumber(query.north, "north");
  const level = readOptionalNonNegativeInteger(query.level, "level");
  const zoom = readOptionalFiniteNumber(query.zoom, "zoom");

  assertRange("west", west, -180, 180);
  assertRange("east", east, -180, 180);
  assertRange("south", south, -90, 90);
  assertRange("north", north, -90, 90);

  if (west > east || south > north) {
    throw new BadRequestException(
      "Viewport bounds must be ordered west <= east and south <= north."
    );
  }

  return {
    west,
    south,
    east,
    north,
    ...(level === undefined ? {} : { level }),
    ...(zoom === undefined ? {} : { zoom })
  };
}

function parseLocateBody(body: TerritoryLocateBodyDto): TerritoryLocateRequest {
  const lat = readFiniteNumber(body.lat, "lat");
  const lng = readFiniteNumber(body.lng, "lng");
  const level = readOptionalNonNegativeInteger(body.level, "level");

  assertRange("lat", lat, -90, 90);

  return {
    coordinate: { lat, lng },
    ...(level === undefined ? {} : { level })
  };
}

function parseRouteBody(body: TerritoryRouteBodyDto): TerritoryRouteRequest {
  const route = normalizeRouteForPostgis(body.route);
  const level = readOptionalNonNegativeInteger(body.level, "level");
  const levels = readOptionalNonNegativeIntegerArray(body.levels, "levels");

  if (body.mode !== undefined && body.mode !== "exact" && body.mode !== "sampled") {
    throw new BadRequestException("mode must be 'exact' or 'sampled'.");
  }

  if (route.length < 2 || computeRouteLengthM(route) <= 0) {
    throw new BadRequestException("route must contain at least two distinct coordinates.");
  }

  return {
    route: { type: "LineString", coordinates: route },
    ...(level === undefined ? {} : { level }),
    ...(levels === undefined ? {} : { levels }),
    ...(body.mode === undefined ? {} : { mode: body.mode })
  };
}

function readOptionalNonNegativeIntegerArray(input: unknown, field: string): number[] | undefined {
  if (input === undefined || input === null) {
    return undefined;
  }

  if (!Array.isArray(input)) {
    throw new BadRequestException(`${field} must be an array of non-negative integers.`);
  }

  return input.map((value, index) => {
    const parsed = readOptionalNonNegativeInteger(value, `${field}[${index}]`);

    if (parsed === undefined) {
      throw new BadRequestException(`${field}[${index}] must be a non-negative integer.`);
    }

    return parsed;
  });
}

function readOptionalFiniteNumber(input: unknown, field: string): number | undefined {
  if (input === undefined || input === null || input === "") {
    return undefined;
  }

  return readFiniteNumber(input, field);
}

function readOptionalNonNegativeInteger(input: unknown, field: string): number | undefined {
  const value = readOptionalFiniteNumber(input, field);

  if (value === undefined) {
    return undefined;
  }

  if (!Number.isInteger(value) || value < 0) {
    throw new BadRequestException(`${field} must be a non-negative integer.`);
  }

  return value;
}

function readFiniteNumber(input: unknown, field: string): number {
  const value =
    typeof input === "number"
      ? input
      : typeof input === "string" && input.trim().length > 0
        ? Number(input)
        : Number.NaN;

  if (!Number.isFinite(value)) {
    throw new BadRequestException(`${field} must be a finite number.`);
  }

  return value;
}

function assertRange(field: string, value: number, min: number, max: number): void {
  if (value < min || value > max) {
    throw new BadRequestException(`${field} must be between ${min} and ${max}.`);
  }
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

function normalizeRouteForPostgis(routeInput: TerritoryRouteInput | unknown): [number, number][] {
  const coordinatesInput =
    isRecord(routeInput) && routeInput.type === "LineString" ? routeInput.coordinates : routeInput;

  if (!Array.isArray(coordinatesInput)) {
    throw new BadRequestException("route must be a GeoJSON LineString or coordinate array.");
  }

  const coordinates: [number, number][] = [];

  for (const coordinateInput of coordinatesInput) {
    const coordinate = readRouteCoordinate(coordinateInput);

    if (!coordinate) {
      throw new BadRequestException("route contains an invalid coordinate.");
    }

    coordinates.push(coordinate);
  }

  return coordinates;
}

function readRouteCoordinate(input: unknown): [number, number] | undefined {
  if (Array.isArray(input)) {
    const lng = readRouteNumber(input[0]);
    const lat = readRouteNumber(input[1]);

    return isValidRouteCoordinate(lng, lat) ? [normalizeLongitude(lng), lat] : undefined;
  }

  if (!isRecord(input)) {
    return undefined;
  }

  const lng = readRouteNumber(input.lng);
  const lat = readRouteNumber(input.lat);

  return isValidRouteCoordinate(lng, lat) ? [normalizeLongitude(lng), lat] : undefined;
}

function readRouteNumber(input: unknown): number {
  return typeof input === "number" ? input : Number.NaN;
}

function isValidRouteCoordinate(lng: number, lat: number): boolean {
  return Number.isFinite(lng) && Number.isFinite(lat) && lat >= -90 && lat <= 90;
}

function computeRouteLengthM(route: readonly [number, number][]): number {
  let lengthM = 0;

  for (let index = 0; index < route.length - 1; index += 1) {
    const start = route[index];
    const end = route[index + 1];

    if (start && end) {
      lengthM += computeLngLatDistanceM(start, end);
    }
  }

  return lengthM;
}

function postgisRowToZone(row: PostgisZoneRow): TerritoryZone {
  const geometry = row.geometry;

  return {
    id: row.id,
    datasetId: row.dataset_id,
    level: row.level,
    ...(row.source_admin_level ? { sourceAdminLevel: row.source_admin_level } : {}),
    ...(row.parent_id ? { parentId: row.parent_id } : {}),
    ...(row.child_ids ? { childIds: row.child_ids } : {}),
    neighborIds: row.neighbor_ids ?? [],
    geometry,
    center: computeGeometryCenter(geometry),
    bbox: computeGeometryBBox(geometry),
    properties: row.properties ?? {}
  };
}

function postgisRowToMetrics(row: PostgisZoneRow): TerritoryGeometryMetrics {
  const zone = postgisRowToZone(row);
  const areaM2 = row.area_m2 ?? computeTerritoryAreaM2(zone.geometry);
  const representativePoint =
    row.representative_point?.coordinates ?? computeTerritoryRepresentativePoint(zone.geometry);

  return {
    areaM2,
    areaKm2: areaM2 / 1_000_000,
    centroid: computeGeometryCenter(zone.geometry),
    representativePoint,
    bbox: computeGeometryBBox(zone.geometry)
  };
}

function postgisRowsToHierarchy(rows: ArrayPostgisZoneRow[]): TerritoryHierarchy | null {
  const [zoneRow, ...ancestorRows] = rows.sort((left, right) => left.depth - right.depth);

  if (!zoneRow) {
    return null;
  }

  const ancestorIds = ancestorRows.map((row) => row.id);
  const missingParentId =
    zoneRow.parent_id && ancestorIds.length === 0 ? zoneRow.parent_id : undefined;
  const rootId = ancestorIds.at(-1) ?? zoneRow.id;

  return {
    territoryId: zoneRow.id,
    parentId: zoneRow.parent_id ?? null,
    ancestorIds,
    childIds: zoneRow.child_ids ?? [],
    pathIds: [...ancestorIds].reverse().concat(zoneRow.id),
    rootId,
    isRoot: !zoneRow.parent_id,
    isOrphan: Boolean(missingParentId),
    ...(missingParentId ? { missingParentId } : {})
  };
}

function postgisRouteRowsToResult(
  rows: PostgisRouteRow[],
  routeLengthM: number
): TerritoryRouteQueryResult {
  const traversal: TerritoryRouteTraversalSegment[] = rows.map((row, sequence) => {
    const zone = postgisRowToZone(row);
    const routeFraction = clampRouteFraction(row.route_fraction ?? 0);
    const coordinate = row.intersection_point?.coordinates ?? zone.center;
    const lengthM = row.intersection_length_m ?? 0;
    const identity = {
      territoryId: row.id,
      datasetId: row.dataset_id,
      datasetVersion: row.dataset_version ?? "",
      geometryVersion: row.geometry_version ?? "",
      geometryHash: row.geometry_version ?? ""
    };

    return {
      territoryId: row.id,
      zone,
      identity,
      method: "exact",
      sequence,
      startCoordinate: coordinate,
      endCoordinate: coordinate,
      startDistanceM: routeFraction * routeLengthM,
      endDistanceM: routeFraction * routeLengthM,
      startFraction: routeFraction,
      endFraction: routeFraction,
      lengthM,
      boundaryOnly: lengthM === 0
    };
  });

  return {
    mode: "exact",
    routeLengthM,
    territories: traversal.map((segment) => ({
      territoryId: segment.territoryId,
      zone: segment.zone,
      identity: segment.identity,
      method: "exact",
      entered: (segment.lengthM ?? 0) > 0,
      boundaryOnly: segment.boundaryOnly === true,
      datasetVersion: segment.identity.datasetVersion,
      geometryVersion: segment.identity.geometryVersion,
      intersectionLengthM: segment.lengthM ?? 0,
      firstIntersection: segment.startCoordinate,
      lastIntersection: segment.endCoordinate,
      routeFractionStart: segment.startFraction,
      routeFractionEnd: segment.endFraction,
      segmentCount: 1
    })),
    traversal
  };
}

function clampRouteFraction(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  if (value >= 1) {
    return 1;
  }

  return value;
}

function postgisImportRow(dataset: TerritoryDataset, zone: TerritoryZone): PostgisImportRow {
  const identity = createTerritoryIdentity(dataset, zone);
  const representativePoint = computeTerritoryRepresentativePoint(zone.geometry);

  return {
    id: zone.id,
    dataset_id: zone.datasetId || dataset.manifest.datasetId,
    dataset_version: dataset.manifest.datasetVersion,
    geometry_version: identity.geometryVersion,
    level: zone.level,
    source_admin_level: zone.sourceAdminLevel ?? null,
    parent_id: zone.parentId ?? null,
    child_ids: zone.childIds ?? [],
    neighbor_ids: zone.neighborIds,
    properties: zone.properties,
    geometry: zone.geometry,
    west: zone.bbox[0],
    south: zone.bbox[1],
    east: zone.bbox[2],
    north: zone.bbox[3],
    area_m2: computeTerritoryAreaM2(zone.geometry),
    representative_lng: representativePoint[0],
    representative_lat: representativePoint[1]
  };
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
