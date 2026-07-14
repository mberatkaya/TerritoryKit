import { describe, expect, it } from "vitest";
import {
  loadTurkeyDataset,
  supportedTurkeyAdminLevels,
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
    expect(supportedTurkeyAdminLevels).toEqual(["ADM0", "ADM1", "ADM2"]);
    await expect(loadTurkeyDataset({})).rejects.toThrow("does not embed geometry artifacts");
  });
});
