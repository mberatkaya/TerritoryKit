create extension if not exists postgis;

create table if not exists territory_zones (
  id text primary key,
  dataset_id text not null,
  level integer not null,
  parent_id text,
  child_ids text[] not null default '{}',
  neighbor_ids text[] not null default '{}',
  properties jsonb not null default '{}',
  geometry geometry(Geometry, 4326) not null
);

create index if not exists territory_zones_dataset_level_idx
  on territory_zones (dataset_id, level);

create index if not exists territory_zones_geometry_gist_idx
  on territory_zones
  using gist (geometry);
