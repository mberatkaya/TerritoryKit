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
        geometryHash: { type: "string", minLength: 1 }
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
        additionalProperties: false
      }
    }
  }
} as const;
