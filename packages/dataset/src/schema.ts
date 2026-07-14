export const TERRITORY_SCHEMA_VERSION = "territory-schema@1" as const;

export const territoryDatasetJsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://territorykit.dev/schemas/territory-schema-1.json",
  title: "TerritoryKit Dataset",
  type: "object",
  required: ["manifest", "zones"],
  additionalProperties: false,
  properties: {
    manifest: {
      type: "object",
      required: ["datasetId", "datasetVersion", "schemaVersion", "sourceDate", "geometryHash"],
      additionalProperties: true,
      properties: {
        datasetId: { type: "string", minLength: 1 },
        datasetVersion: { type: "string", minLength: 1 },
        schemaVersion: { const: TERRITORY_SCHEMA_VERSION },
        sourceDate: { type: "string", minLength: 1 },
        geometryHash: { type: "string", minLength: 1 },
        adminLevels: {
          type: "array",
          items: { enum: ["ADM0", "ADM1", "ADM2", "ADM3", "ADM4"] },
          minItems: 1
        },
        artifactChecksum: { type: "string", minLength: 1 },
        attribution: { type: "string", minLength: 1 },
        boundaryPolicy: { type: "string", minLength: 1 },
        buildDate: { type: "string", minLength: 1 },
        countryCodes: {
          type: "array",
          items: { pattern: "^[A-Za-z]{2}$", type: "string" },
          minItems: 1
        },
        crs: { type: "string", minLength: 1 },
        disputedAreaPolicy: { type: "string", minLength: 1 },
        geometryDetail: { enum: ["low", "medium", "high", "source"] },
        license: { type: "string", minLength: 1 },
        sourceProvider: { type: "string", minLength: 1 },
        worldview: { type: "string", minLength: 1 }
      }
    },
    zones: {
      type: "array",
      items: {
        type: "object",
        required: [
          "id",
          "datasetId",
          "level",
          "neighborIds",
          "geometry",
          "center",
          "bbox",
          "properties"
        ],
        additionalProperties: false,
        properties: {
          id: { type: "string", minLength: 1 },
          datasetId: { type: "string", minLength: 1 },
          countryCode: { pattern: "^[A-Za-z]{2}$", type: "string" },
          level: { type: "integer", minimum: 0 },
          sourceAdminLevel: { type: "string", minLength: 1 },
          semanticType: {
            enum: [
              "world",
              "country",
              "state",
              "province",
              "region",
              "governorate",
              "prefecture",
              "county",
              "district",
              "city",
              "municipality",
              "borough",
              "ward",
              "neighbourhood",
              "village",
              "local",
              "game-region",
              "unknown"
            ]
          },
          name: { type: "string", minLength: 1 },
          localName: { type: "string", minLength: 1 },
          parentId: { type: "string", minLength: 1 },
          childIds: {
            type: "array",
            items: { type: "string", minLength: 1 }
          },
          neighborIds: {
            type: "array",
            items: { type: "string", minLength: 1 }
          },
          geometry: {
            type: "object"
          },
          center: {
            type: "array",
            prefixItems: [{ type: "number" }, { type: "number" }],
            minItems: 2
          },
          bbox: {
            type: "array",
            prefixItems: [
              { type: "number" },
              { type: "number" },
              { type: "number" },
              { type: "number" }
            ],
            minItems: 4,
            maxItems: 4
          },
          properties: {
            type: "object"
          }
        }
      }
    }
  }
} as const;
