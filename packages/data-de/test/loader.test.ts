import { describe, expect, it } from "vitest";
import {
  germanyDatasetDescriptor,
  loadGermanyDataset,
  supportedGermanyAdminLevels
} from "../src/index.js";

describe("@territory-kit/data-de", () => {
  it("describes a thin resolver-driven country loader", async () => {
    expect(germanyDatasetDescriptor).toMatchObject({
      countryCodeAlpha2: "DE",
      countryCodeAlpha3: "DEU",
      packageName: "@territory-kit/data-de",
      requiresResolver: true
    });
    expect(supportedGermanyAdminLevels).toEqual(["ADM0", "ADM1", "ADM2"]);
    await expect(loadGermanyDataset({})).rejects.toThrow("does not embed geometry artifacts");
  });
});
