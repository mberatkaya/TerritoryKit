import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createTurkeyV2Adm3StableKey, createTurkeyV2Adm3TerritoryId } from "../src/index.js";

describe("Turkey V2 ADM3 stable identity", () => {
  it("creates deterministic IDs from the same input", () => {
    const input = {
      provinceCode: "34",
      districtCode: "003",
      sourceClass: "official" as const,
      sourceNativeId: "123456",
      name: "İstiklal"
    };

    expect(createTurkeyV2Adm3TerritoryId(input)).toBe(createTurkeyV2Adm3TerritoryId(input));
    expect(createTurkeyV2Adm3TerritoryId(input)).toBe("tr:adm3:tr-il-34-ilce-003-official-123456");
  });

  it("isolates the same source-native ID across parent district context", () => {
    const first = createTurkeyV2Adm3TerritoryId({
      provinceCode: "34",
      districtCode: "003",
      sourceClass: "official",
      sourceNativeId: "123456"
    });
    const second = createTurkeyV2Adm3TerritoryId({
      provinceCode: "34",
      districtCode: "004",
      sourceClass: "official",
      sourceNativeId: "123456"
    });

    expect(first).not.toBe(second);
  });

  it("isolates official, OSM, and generated source classes", () => {
    const base = {
      provinceCode: "34",
      districtCode: "003",
      sourceNativeId: "123456"
    };

    expect(
      new Set([
        createTurkeyV2Adm3TerritoryId({ ...base, sourceClass: "official" }),
        createTurkeyV2Adm3TerritoryId({ ...base, sourceClass: "osm" }),
        createTurkeyV2Adm3TerritoryId({
          ...base,
          sourceClass: "generated",
          algorithmVersion: "tr-adm3-generated-zone-v1"
        })
      ]).size
    ).toBe(3);
  });

  it("normalizes Turkish I variants and Unicode normalization forms", () => {
    const base = {
      provinceCode: "34",
      districtCode: "003",
      sourceClass: "official" as const
    };

    expect(createTurkeyV2Adm3TerritoryId({ ...base, name: "IŞIK" })).toBe(
      createTurkeyV2Adm3TerritoryId({ ...base, name: "ışık" })
    );
    expect(createTurkeyV2Adm3TerritoryId({ ...base, name: "Çağlayan" })).toBe(
      createTurkeyV2Adm3TerritoryId({ ...base, name: "Çağlayan" })
    );
  });

  it("preserves identity across name changes when source-native ID is present", () => {
    const base = {
      provinceCode: "34",
      districtCode: "003",
      sourceClass: "official" as const,
      sourceNativeId: "MAKS-123"
    };

    expect(createTurkeyV2Adm3TerritoryId({ ...base, name: "Old Name" })).toBe(
      createTurkeyV2Adm3TerritoryId({ ...base, name: "New Name" })
    );
  });

  it("keeps generated rebuilds deterministic and documents algorithm-version changes", () => {
    const base = {
      provinceCode: "34",
      districtCode: "003",
      sourceClass: "generated" as const,
      generationSeed: "district-003-cell-42",
      localKey: "000042"
    };
    const v1 = createTurkeyV2Adm3TerritoryId({
      ...base,
      algorithmVersion: "tr-adm3-generated-zone-v1"
    });
    const v1Again = createTurkeyV2Adm3TerritoryId({
      ...base,
      algorithmVersion: "tr-adm3-generated-zone-v1"
    });
    const v2 = createTurkeyV2Adm3TerritoryId({
      ...base,
      algorithmVersion: "tr-adm3-generated-zone-v2"
    });

    expect(v1).toBe(v1Again);
    expect(v1).not.toBe(v2);
  });

  it("round-trips through JSON serialization", () => {
    const input = {
      provinceCode: "34",
      districtCode: "003",
      sourceClass: "osm" as const,
      sourceNativeId: "relation-987654",
      name: "Cankurtaran"
    };
    const serialized = JSON.parse(JSON.stringify(input)) as typeof input;

    expect(createTurkeyV2Adm3StableKey(serialized)).toBe(createTurkeyV2Adm3StableKey(input));
  });

  it("checks collision resistance across parent and source-class contexts", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            provinceCode: fc.integer({ min: 1, max: 81 }).map(String),
            districtCode: fc.integer({ min: 1, max: 999 }).map(String),
            sourceClass: fc.constantFrom("official", "osm"),
            sourceNativeId: fc.stringMatching(/^[A-Za-z0-9]{1,8}$/)
          }),
          { minLength: 1, maxLength: 40 }
        ),
        (inputs) => {
          const expectedUnique = new Set(
            inputs.map(
              (input) =>
                `${input.provinceCode.padStart(2, "0")}:${input.districtCode.padStart(3, "0")}:${
                  input.sourceClass
                }:${input.sourceNativeId.toLowerCase()}`
            )
          );
          const ids = new Set(inputs.map((input) => createTurkeyV2Adm3TerritoryId(input)));

          expect(ids.size).toBe(expectedUnique.size);
        }
      ),
      { numRuns: 50 }
    );
  });
});
