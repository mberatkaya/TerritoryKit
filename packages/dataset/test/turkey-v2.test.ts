import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  TERRITORY_SEMANTIC_ADMIN_TYPES,
  loadTerritoryDataset,
  territoryDatasetJsonSchema,
  validateTerritoryDataset
} from "../src/index.js";
import { validateTurkeyV2Dataset } from "../src/turkey-v2.js";
import {
  createAdm3Zone,
  createGaziantepPilotCompatibilityFixture,
  createLegacySchemaV1Dataset,
  createTurkeyV2Fixture
} from "./turkey-v2.fixtures.js";
import type { TerritoryDataset, TerritorySourceClass } from "../src/index.js";

describe("Turkey V2 dataset contract", () => {
  it("validates official, OSM, generated, hybrid, Turkish-name, and MultiPolygon ADM3 fixtures", () => {
    const dataset = createTurkeyV2Fixture([
      createAdm3Zone({
        id: "tr:adm3:34-003-official-neighbourhood",
        name: "İstiklal",
        semanticType: "neighbourhood",
        sourceClass: "official",
        sourceNativeId: "official-1",
        west: 28.94,
        east: 28.955
      }),
      createAdm3Zone({
        id: "tr:adm3:34-003-official-village",
        name: "Karaağaç",
        semanticType: "village",
        sourceClass: "official",
        sourceNativeId: "official-2",
        west: 28.955,
        east: 28.97,
        multipolygon: true
      }),
      createAdm3Zone({
        id: "tr:adm3:34-003-osm-neighbourhood",
        name: "Cankurtaran",
        semanticType: "neighbourhood",
        sourceClass: "osm",
        sourceNativeId: "relation-987654",
        west: 28.97,
        east: 28.985
      }),
      createAdm3Zone({
        id: "tr:adm3:34-003-osm-village",
        name: "Köyiçi",
        semanticType: "village",
        sourceClass: "osm",
        sourceNativeId: "relation-987655",
        west: 28.985,
        east: 29
      }),
      createAdm3Zone({
        id: "tr:adm3:34-003-generated-000042",
        name: "Generated zone 42",
        semanticType: "generated-zone",
        sourceClass: "generated",
        sourceNativeId: "000042",
        west: 29,
        east: 29.02
      })
    ]);

    const result = validateTurkeyV2Dataset(dataset);

    expect(result.ok).toBe(true);
    expect(result.dataset?.zones.filter((zone) => zone.level === 3)).toHaveLength(5);
  });

  it("reports machine-readable strict validation errors", () => {
    const invalidCases: Array<{
      name: string;
      dataset: TerritoryDataset;
      code: string;
    }> = [
      {
        name: "source flag conflict",
        dataset: createTurkeyV2Fixture([
          createAdm3Zone({
            id: "tr:adm3:flag-conflict",
            name: "Flag Conflict",
            semanticType: "neighbourhood",
            sourceClass: "official",
            official: false,
            sourceNativeId: "1",
            west: 28.94,
            east: 28.96
          })
        ]),
        code: "SOURCE_FLAG_CONFLICT"
      },
      {
        name: "orphan ADM3",
        dataset: createOrphanAdm3Fixture(),
        code: "ADM3_ORPHAN"
      },
      {
        name: "wrong parent level",
        dataset: createWrongAdm3ParentLevelFixture(),
        code: "INVALID_PARENT_LEVEL"
      },
      {
        name: "province mismatch",
        dataset: createTurkeyV2Fixture([
          createAdm3Zone({
            id: "tr:adm3:province-mismatch",
            name: "Province Mismatch",
            semanticType: "neighbourhood",
            sourceClass: "official",
            provinceCode: "35",
            sourceNativeId: "1",
            west: 28.94,
            east: 28.96
          })
        ]),
        code: "HIERARCHY_CODE_MISMATCH"
      },
      {
        name: "duplicate stable id",
        dataset: createTurkeyV2Fixture([
          createAdm3Zone({
            id: "tr:adm3:duplicate-a",
            stableId: "tr:adm3:stable-duplicate",
            name: "Duplicate A",
            semanticType: "neighbourhood",
            sourceClass: "official",
            sourceNativeId: "1",
            west: 28.94,
            east: 28.96
          }),
          createAdm3Zone({
            id: "tr:adm3:duplicate-b",
            stableId: "tr:adm3:stable-duplicate",
            name: "Duplicate B",
            semanticType: "neighbourhood",
            sourceClass: "osm",
            sourceNativeId: "relation-1",
            west: 28.96,
            east: 28.98
          })
        ]),
        code: "DUPLICATE_STABLE_ID"
      },
      {
        name: "missing algorithm version",
        dataset: createTurkeyV2Fixture([
          createAdm3Zone({
            id: "tr:adm3:generated-missing-version",
            name: "Generated Missing Version",
            semanticType: "generated-zone",
            sourceClass: "generated",
            sourceNativeId: "1",
            omitAlgorithmVersion: true,
            west: 28.94,
            east: 28.96
          })
        ]),
        code: "MISSING_GENERATOR_VERSION"
      },
      {
        name: "generated zone marked official",
        dataset: createTurkeyV2Fixture([
          createAdm3Zone({
            id: "tr:adm3:generated-false-official",
            name: "Generated False Official",
            semanticType: "generated-zone",
            sourceClass: "generated",
            sourceNativeId: "1",
            official: true,
            generated: true,
            west: 28.94,
            east: 28.96
          })
        ]),
        code: "SOURCE_FLAG_CONFLICT"
      },
      {
        name: "generated zone presented as mahalle",
        dataset: createTurkeyV2Fixture([
          createAdm3Zone({
            id: "tr:adm3:generated-wrong-semantic",
            name: "Generated Wrong Semantic",
            semanticType: "neighbourhood",
            sourceClass: "generated",
            sourceNativeId: "1",
            west: 28.94,
            east: 28.96
          })
        ]),
        code: "INVALID_GENERATED_SEMANTIC_TYPE"
      },
      {
        name: "official missing provenance",
        dataset: createTurkeyV2Fixture([
          createAdm3Zone({
            id: "tr:adm3:missing-provenance",
            name: "Missing Provenance",
            semanticType: "neighbourhood",
            sourceClass: "official",
            sourceNativeId: "1",
            omitProvenance: true,
            west: 28.94,
            east: 28.96
          })
        ]),
        code: "MISSING_SOURCE_PROVENANCE"
      },
      {
        name: "smart-derived marked administrative",
        dataset: createTurkeyV2Fixture([
          createAdm3Zone({
            id: "tr:adm3:smart-derived-administrative",
            name: "Smart Derived Administrative",
            semanticType: "generated-zone",
            sourceClass: "generated",
            boundarySourceClass: "smart-derived",
            administrative: true,
            sourceNativeId: "1",
            west: 28.94,
            east: 28.96
          })
        ]),
        code: "INVALID_BOUNDARY_METADATA"
      },
      {
        name: "missing source snapshot checksum",
        dataset: createTurkeyV2Fixture([
          createAdm3Zone({
            id: "tr:adm3:missing-source-snapshot",
            name: "Missing Source Snapshot",
            semanticType: "neighbourhood",
            sourceClass: "official",
            sourceNativeId: "1",
            omitSourceSnapshotChecksum: true,
            west: 28.94,
            east: 28.96
          })
        ]),
        code: "MISSING_BOUNDARY_PROVENANCE"
      },
      {
        name: "authoritative source license not approved",
        dataset: createTurkeyV2Fixture([
          createAdm3Zone({
            id: "tr:adm3:authoritative-license-pending",
            name: "Authoritative License Pending",
            semanticType: "neighbourhood",
            sourceClass: "official",
            sourceNativeId: "1",
            licenseState: "pending",
            west: 28.94,
            east: 28.96
          })
        ]),
        code: "LICENSE_GATE_FAILED"
      },
      {
        name: "invalid coverage status",
        dataset: createTurkeyV2Fixture([
          createAdm3Zone({
            id: "tr:adm3:invalid-coverage",
            name: "Invalid Coverage",
            semanticType: "neighbourhood",
            sourceClass: "official",
            sourceNativeId: "1",
            coverageStatus: "complete",
            west: 28.94,
            east: 28.96
          })
        ]),
        code: "INVALID_COVERAGE_STATUS"
      },
      {
        name: "invalid semantic review status",
        dataset: createTurkeyV2Fixture([
          createAdm3Zone({
            id: "tr:adm3:invalid-review",
            name: "Invalid Review",
            semanticType: "neighbourhood",
            sourceClass: "official",
            sourceNativeId: "1",
            semanticReviewStatus: "done",
            west: 28.94,
            east: 28.96
          })
        ]),
        code: "INVALID_SEMANTIC_REVIEW_STATUS"
      }
    ];

    for (const invalidCase of invalidCases) {
      const result = validateTurkeyV2Dataset(invalidCase.dataset);

      expect(result.ok, invalidCase.name).toBe(false);
      expect(result.issues, invalidCase.name).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: invalidCase.code })])
      );
    }
  });

  it("keeps legacy schema-v1 datasets readable outside strict TR V2 validation", () => {
    const legacy = createLegacySchemaV1Dataset();

    expect(loadTerritoryDataset(legacy).manifest.schemaVersion).toBe("territory-schema@1");
    expect(validateTurkeyV2Dataset(legacy)).toMatchObject({
      ok: true,
      issues: []
    });
  });

  it("keeps the Gaziantep pilot compatibility fixture readable", () => {
    const fixture = createGaziantepPilotCompatibilityFixture();

    expect(validateTerritoryDataset(fixture).ok).toBe(true);
    expect(validateTurkeyV2Dataset(fixture).ok).toBe(true);
  });

  it("keeps parent cycle detection active in the strict profile", () => {
    const result = validateTurkeyV2Dataset(
      createTurkeyV2Fixture(
        [
          createAdm3Zone({
            id: "tr:adm3:cycle-child",
            name: "Cycle Child",
            semanticType: "neighbourhood",
            sourceClass: "official",
            sourceNativeId: "1",
            west: 28.94,
            east: 28.96
          })
        ],
        { cycle: true }
      )
    );

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "HIERARCHY_CYCLE" })])
    );
  });

  it("serializes and reloads V2 metadata without loss", () => {
    const dataset = createTurkeyV2Fixture([
      createAdm3Zone({
        id: "tr:adm3:round-trip",
        name: "Çağlayan",
        semanticType: "neighbourhood",
        sourceClass: "official",
        sourceNativeId: "round-trip-1",
        west: 28.94,
        east: 28.96,
        multipolygon: true
      })
    ]);
    const parsed = JSON.parse(JSON.stringify(dataset)) as unknown;
    const result = validateTurkeyV2Dataset(parsed);

    expect(result.ok).toBe(true);
    expect(result.dataset?.zones.at(-1)?.properties).toMatchObject({
      territory: {
        sourceClass: "official",
        provinceCode: "34",
        districtCode: "003"
      }
    });
  });

  it("exposes schema-v1 additive metadata for generated zones and source classes", () => {
    const zoneSchema = territoryDatasetJsonSchema.properties.zones.items.properties;
    const territorySchema = zoneSchema.properties.properties.territory.properties;

    expect(TERRITORY_SEMANTIC_ADMIN_TYPES).toContain("generated-zone");
    expect(zoneSchema.semanticType.enum).toContain("generated-zone");
    expect(territorySchema.sourceClass.enum).toEqual(["official", "osm", "generated"]);
    expect(territorySchema.boundaryKind.enum).toEqual(["administrative", "estimated"]);
    expect(territorySchema.boundarySourceClass.enum).toEqual([
      "official-national",
      "official-local",
      "osm-administrative",
      "smart-derived",
      "synthetic-test"
    ]);
    expect(territorySchema.confidence.enum).toEqual(["authoritative", "high", "medium", "low"]);
    expect(territorySchema.semanticType.enum).toContain("generated-zone");
  });

  it("accepts only sourceClass-consistent official/generated flags", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<TerritorySourceClass>("official", "osm", "generated"),
        fc.boolean(),
        fc.boolean(),
        (sourceClass, official, generated) => {
          const expected =
            sourceClass === "official"
              ? { official: true, generated: false }
              : sourceClass === "generated"
                ? { official: false, generated: true }
                : { official: false, generated: false };
          const semanticType = sourceClass === "generated" ? "generated-zone" : "neighbourhood";
          const dataset = createTurkeyV2Fixture([
            createAdm3Zone({
              id: `tr:adm3:${sourceClass}-${String(official)}-${String(generated)}`,
              name: "Property Flag",
              semanticType,
              sourceClass,
              sourceNativeId: "property-flag",
              official,
              generated,
              west: 28.94,
              east: 28.96
            })
          ]);
          const result = validateTurkeyV2Dataset(dataset);
          const flagsMatch = official === expected.official && generated === expected.generated;

          expect(result.ok).toBe(flagsMatch);
        }
      ),
      { numRuns: 24 }
    );
  });
});

function createOrphanAdm3Fixture(): TerritoryDataset {
  const dataset = createTurkeyV2Fixture([
    createAdm3Zone({
      id: "tr:adm3:orphan",
      name: "Orphan",
      semanticType: "neighbourhood",
      sourceClass: "official",
      sourceNativeId: "1",
      west: 28.94,
      east: 28.96
    })
  ]);
  const parent = dataset.zones.find((zone) => zone.id === "tr:adm2:34-003");
  const child = dataset.zones.find((zone) => zone.id === "tr:adm3:orphan");
  const territory =
    child && typeof child.properties.territory === "object" && child.properties.territory !== null
      ? (child.properties.territory as Record<string, unknown>)
      : undefined;

  if (parent) {
    delete parent.childIds;
  }

  if (child && territory) {
    delete child.parentId;
    delete territory.parentId;
  }

  return dataset;
}

function createWrongAdm3ParentLevelFixture(): TerritoryDataset {
  const dataset = createTurkeyV2Fixture([
    createAdm3Zone({
      id: "tr:adm3:wrong-parent",
      name: "Wrong Parent",
      semanticType: "neighbourhood",
      sourceClass: "official",
      parentId: "tr:adm1:34",
      sourceNativeId: "1",
      west: 28.94,
      east: 28.96
    })
  ]);
  const parent = dataset.zones.find((zone) => zone.id === "tr:adm2:34-003");

  if (parent) {
    delete parent.childIds;
  }

  return dataset;
}
