# @territory-kit/nestjs

NestJS integration boundary for TerritoryKit engines and optional PostGIS-backed repository implementations.

## Installation

```sh
pnpm add @territory-kit/nestjs @territory-kit/core @territory-kit/dataset @nestjs/common @nestjs/swagger rxjs
```

## Basic Usage

```ts
import { Module } from "@nestjs/common";
import { TerritoryKitModule } from "@territory-kit/nestjs";

@Module({
  imports: [
    TerritoryKitModule.forRoot({
      dataset
    })
  ]
})
export class AppModule {}
```

## API Summary

- `TerritoryKitModule.forRoot(options)` registers the engine and optional repository.
- `TerritoryKitController` exposes viewport and locate endpoints.
- `TerritoryRepository` defines async `findVisibleZones` and `locateZone` boundaries.
- `createPostgisTerritoryRepository(client, options)` adapts a PostGIS query client.
- `TERRITORY_KIT_ENGINE`, `TERRITORY_KIT_OPTIONS`, and `TERRITORY_KIT_REPOSITORY` expose DI tokens.

## License

Apache-2.0
