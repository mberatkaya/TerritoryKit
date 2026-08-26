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
          items: { enum: ["ADM0", "ADM1", "ADM2", "ADM3", "ADM4", "ADM5"] },
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
              "subdistrict",
              "city",
              "municipality",
              "borough",
              "commune",
              "ward",
              "neighbourhood",
              "village",
              "locality",
              "local",
              "special-administrative-area",
              "administrative-unit",
              "generated-zone",
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
            type: "object",
            additionalProperties: true,
            properties: {
              territory: {
                type: "object",
                additionalProperties: true,
                properties: {
                  adminLevel: { enum: ["ADM0", "ADM1", "ADM2", "ADM3", "ADM4", "ADM5"] },
                  sourceAdminLevel: { enum: ["ADM0", "ADM1", "ADM2", "ADM3", "ADM4", "ADM5"] },
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
                      "subdistrict",
                      "city",
                      "municipality",
                      "borough",
                      "commune",
                      "ward",
                      "neighbourhood",
                      "village",
                      "locality",
                      "local",
                      "special-administrative-area",
                      "administrative-unit",
                      "generated-zone",
                      "game-region",
                      "unknown"
                    ]
                  },
                  localType: { type: "string", minLength: 1 },
                  localTypeName: { type: "string", minLength: 1 },
                  hierarchyDepth: { type: "integer", minimum: 0, maximum: 5 },
                  parentId: { type: "string", minLength: 1 },
                  sourceParentId: { type: "string", minLength: 1 },
                  countryCode: { pattern: "^[A-Za-z]{2}$", type: "string" },
                  provinceCode: { type: "string", minLength: 1 },
                  districtCode: { type: "string", minLength: 1 },
                  sourceClass: { enum: ["official", "osm", "generated"] },
                  boundaryKind: { enum: ["administrative", "estimated"] },
                  boundarySourceClass: {
                    enum: [
                      "official-national",
                      "official-local",
                      "osm-administrative",
                      "smart-derived",
                      "synthetic-test"
                    ]
                  },
                  confidence: { enum: ["authoritative", "high", "medium", "low"] },
                  administrative: { type: "boolean" },
                  providerId: { type: "string", minLength: 1 },
                  providerName: { type: "string", minLength: 1 },
                  sourceProvider: { type: "string", minLength: 1 },
                  sourceId: { type: "string", minLength: 1 },
                  sourceDatasetId: { type: "string", minLength: 1 },
                  sourceNativeId: { type: "string", minLength: 1 },
                  sourceDate: { type: "string", minLength: 1 },
                  sourceVersion: { type: "string", minLength: 1 },
                  sourceUrl: { type: "string", minLength: 1 },
                  sourceSnapshotId: { type: "string", minLength: 1 },
                  sourceSnapshotChecksum: { type: "string", minLength: 1 },
                  licenseState: { enum: ["approved", "pending", "restricted", "unknown"] },
                  license: { type: "string", minLength: 1 },
                  attribution: { type: "string", minLength: 1 },
                  official: { type: "boolean" },
                  generated: { type: "boolean" },
                  algorithmVersion: { type: "string", minLength: 1 },
                  generationSeed: { type: "string", minLength: 1 },
                  stableId: { type: "string", minLength: 1 },
                  geometryVersion: { type: "string", minLength: 1 },
                  geometryHash: { type: "string", minLength: 1 },
                  originalGeometryHash: { type: "string", minLength: 1 },
                  effectiveGeometryHash: { type: "string", minLength: 1 },
                  revision: { type: "string", minLength: 1 },
                  areaM2: { type: "number", minimum: 0 },
                  representativePoint: {
                    type: "array",
                    prefixItems: [{ type: "number" }, { type: "number" }],
                    minItems: 2,
                    maxItems: 2
                  },
                  semanticReviewStatus: {
                    enum: [
                      "reviewed",
                      "review-required",
                      "mapping-review-required",
                      "not-applicable"
                    ]
                  },
                  coverageStatus: {
                    enum: [
                      "verified",
                      "generated",
                      "generated-with-warnings",
                      "partial",
                      "source-unavailable",
                      "licence-restricted",
                      "semantic-review-required",
                      "deprecated"
                    ]
                  },
                  source: {
                    type: "object",
                    additionalProperties: true,
                    properties: {
                      provider: { type: "string", minLength: 1 },
                      sourceClass: { enum: ["official", "osm", "generated"] },
                      boundarySourceClass: {
                        enum: [
                          "official-national",
                          "official-local",
                          "osm-administrative",
                          "smart-derived",
                          "synthetic-test"
                        ]
                      },
                      providerId: { type: "string", minLength: 1 },
                      providerName: { type: "string", minLength: 1 },
                      sourceDatasetId: { type: "string", minLength: 1 },
                      sourceId: { type: "string", minLength: 1 },
                      sourceNativeId: { type: "string", minLength: 1 },
                      sourceUrl: { type: "string", minLength: 1 },
                      sourceDate: { type: "string", minLength: 1 },
                      sourceVersion: { type: "string", minLength: 1 },
                      sourceSnapshotId: { type: "string", minLength: 1 },
                      sourceSnapshotChecksum: { type: "string", minLength: 1 },
                      importedAt: { type: "string", minLength: 1 },
                      licenseState: { enum: ["approved", "pending", "restricted", "unknown"] },
                      license: { type: "string", minLength: 1 },
                      attribution: { type: "string", minLength: 1 }
                    }
                  },
                  generatedZone: {
                    type: "object",
                    additionalProperties: true,
                    properties: {
                      algorithm: { type: "string", minLength: 1 },
                      algorithmVersion: { type: "string", minLength: 1 },
                      seed: { type: "string", minLength: 1 },
                      generationSeed: { type: "string", minLength: 1 },
                      localKey: { type: "string", minLength: 1 },
                      targetAreaKm2: { type: "number" },
                      minAreaKm2: { type: "number" },
                      maxAreaKm2: { type: "number" },
                      maxZonesPerDistrict: { type: "integer", minimum: 1 },
                      minFragmentAreaKm2: { type: "number" }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
} as const;
