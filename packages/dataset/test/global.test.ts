import { describe, expect, it } from "vitest";
import {
  createTerritoryGlobalId,
  normalizeTerritoryCountryCode,
  slugifyTerritoryIdPart,
  validateGlobalDatasetManifest,
  validateTerritoryGlobalId,
  validateTerritoryGlobalMetadata
} from "../src/index.js";
import type { TerritoryGlobalDatasetManifest, TerritoryGlobalMetadata } from "../src/index.js";

describe("global territory ids", () => {
  it("accepts valid global territory ids", () => {
    expect(validateTerritoryGlobalId("tr").ok).toBe(true);
    expect(validateTerritoryGlobalId("tr:adm1:34")).toMatchObject({
      ok: true,
      value: {
        adminLevel: "ADM1",
        countryCode: "tr",
        localId: "34"
      }
    });
    expect(validateTerritoryGlobalId("us:adm2:los-angeles-county").ok).toBe(true);
  });

  it("rejects invalid global territory ids", () => {
    expect(validateTerritoryGlobalId("turkey").ok).toBe(false);
    expect(validateTerritoryGlobalId("TR").ok).toBe(false);
    expect(validateTerritoryGlobalId("tr:adm5:fatih").ok).toBe(false);
    expect(validateTerritoryGlobalId("tr:adm0:turkey").ok).toBe(false);
    expect(validateTerritoryGlobalId("tr:ADM2:fatih").ok).toBe(false);
    expect(validateTerritoryGlobalId("TR:ADM2:Fatih").ok).toBe(false);
  });

  it("normalizes ISO country codes for ids", () => {
    expect(normalizeTerritoryCountryCode(" TR ")).toBe("tr");
    expect(() => normalizeTerritoryCountryCode("TUR")).toThrow("ISO 3166-1 alpha-2");
  });

  it("allows same-name territories to keep distinct stable ids", () => {
    const turkeySpringfield = createTerritoryGlobalId({
      countryCode: "TR",
      adminLevel: "ADM2",
      localId: "springfield-001"
    });
    const unitedStatesSpringfield = createTerritoryGlobalId({
      countryCode: "US",
      adminLevel: "ADM2",
      localId: "springfield-001"
    });

    expect(turkeySpringfield).toBe("tr:adm2:springfield-001");
    expect(unitedStatesSpringfield).toBe("us:adm2:springfield-001");
    expect(turkeySpringfield).not.toBe(unitedStatesSpringfield);
  });

  it("creates deterministic ids and Unicode-safe slugs", () => {
    expect(createTerritoryGlobalId({ countryCode: "TR" })).toBe("tr");
    expect(
      createTerritoryGlobalId({
        countryCode: "TR",
        adminLevel: "adm2",
        localId: " Fatih İlçesi "
      })
    ).toBe("tr:adm2:fatih-ilcesi");
    expect(slugifyTerritoryIdPart("Diyarbakır Büyükşehir")).toBe("diyarbakir-buyuksehir");
  });
});

describe("global territory metadata", () => {
  it("validates global metadata stored in zone properties", () => {
    const metadata: TerritoryGlobalMetadata = {
      adminLevel: "ADM2",
      localType: "district",
      codes: {
        iso3166_1: "TR",
        official: "3410",
        source: "source-3410"
      },
      names: {
        default: "Fatih",
        tr: "Fatih"
      },
      source: {
        provider: "official-statistics-office",
        sourceDate: "2026-01-01",
        license: "Open data license",
        attribution: "Official statistics office"
      }
    };

    expect(validateTerritoryGlobalMetadata(metadata)).toMatchObject({
      ok: true,
      value: {
        adminLevel: "ADM2",
        localType: "district"
      }
    });
  });

  it("rejects missing attribution", () => {
    const result = validateTerritoryGlobalMetadata({
      adminLevel: "ADM1",
      source: {
        provider: "source",
        sourceDate: "2026-01-01",
        license: "license"
      }
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "GLOBAL_METADATA",
        path: "$.source.attribution"
      })
    );
  });

  it("rejects invalid ADM levels", () => {
    const result = validateTerritoryGlobalMetadata({
      adminLevel: "ADM9",
      source: {
        provider: "source",
        sourceDate: "2026-01-01",
        license: "license",
        attribution: "attribution"
      }
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "ADMIN_LEVEL",
        path: "$.adminLevel"
      })
    );
  });
});

describe("global dataset manifests", () => {
  it("validates global manifest provenance requirements", () => {
    expect(validateGlobalDatasetManifest(globalManifest())).toMatchObject({
      ok: true,
      value: {
        countryCodes: ["tr", "us"],
        adminLevels: ["ADM0", "ADM1"],
        geometryDetail: "medium"
      }
    });
  });

  it("rejects incomplete manifests", () => {
    const { attribution: _attribution, ...manifest } = globalManifest();
    const result = validateGlobalDatasetManifest(manifest);

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "GLOBAL_MANIFEST",
        path: "$.attribution"
      })
    );
  });
});

function globalManifest(): TerritoryGlobalDatasetManifest {
  return {
    datasetId: "world-countries",
    datasetVersion: "0.1.0",
    schemaVersion: "territory-schema@1",
    countryCodes: ["TR", "us"],
    adminLevels: ["ADM0", "ADM1"],
    sourceProvider: "Natural Earth",
    sourceDate: "2025-01-01",
    buildDate: "2026-07-14",
    license: "Public domain",
    attribution: "Natural Earth",
    crs: "EPSG:4326",
    geometryDetail: "medium",
    geometryHash: "sha256:geometry",
    artifactChecksum: "sha256:artifact",
    boundaryPolicy: "source-represented",
    worldview: "international",
    disputedAreaPolicy: "source-disputed-flags"
  };
}
