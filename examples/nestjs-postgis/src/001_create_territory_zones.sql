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
