import { describe, expect, it } from "vitest";
import {
  defaultTurkeyAdminLevels,
  isTurkeyAdm3ParentCovered,
  loadTurkeyDataset,
  supportedTurkeyAdminLevels,
  turkeyAdm3NeighbourhoodCoverage,
  turkeyDatasetDescriptor
} from "../src/index.js";

describe("@territory-kit/data-tr", () => {
  it("describes a thin resolver-driven country loader", async () => {
    expect(turkeyDatasetDescriptor).toMatchObject({
      countryCodeAlpha2: "TR",
      countryCodeAlpha3: "TUR",
      packageName: "@territory-kit/data-tr",
      requiresResolver: true
    });
    expect(supportedTurkeyAdminLevels).toEqual(["ADM0", "ADM1", "ADM2", "ADM3"]);
    expect(defaultTurkeyAdminLevels).toEqual(["ADM0", "ADM1", "ADM2"]);
    await expect(loadTurkeyDataset({})).rejects.toThrow("does not embed geometry artifacts");
  });

  it("exposes partial Gaziantep ADM3 availability without bundling geometry", () => {
    expect(turkeyAdm3NeighbourhoodCoverage).toMatchObject({
      level: "ADM3",
      semanticType: "neighbourhood",
      localTypeName: "Mahalle",
      status: "partial",
      license: "CC BY 4.0"
    });
    expect(turkeyAdm3NeighbourhoodCoverage.coveredParentIds).toHaveLength(9);
    expect(isTurkeyAdm3ParentCovered("tr:adm2:54988432b26387222249237")).toBe(true);
    expect(isTurkeyAdm3ParentCovered("tr:adm2:not-covered")).toBe(false);
  });
});
