import { describe, expect, it } from "vitest";
import {
  loadUnitedStatesDataset,
  supportedUnitedStatesAdminLevels,
  unitedStatesDatasetDescriptor
} from "../src/index.js";

describe("@territory-kit/data-us", () => {
  it("describes a thin resolver-driven country loader", async () => {
    expect(unitedStatesDatasetDescriptor).toMatchObject({
      countryCodeAlpha2: "US",
      countryCodeAlpha3: "USA",
      packageName: "@territory-kit/data-us",
      requiresResolver: true
    });
    expect(supportedUnitedStatesAdminLevels).toEqual(["ADM0", "ADM1", "ADM2"]);
    await expect(loadUnitedStatesDataset({})).rejects.toThrow("does not embed geometry artifacts");
  });
});
