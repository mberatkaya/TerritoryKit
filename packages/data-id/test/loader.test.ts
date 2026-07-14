import { describe, expect, it } from "vitest";
import {
  indonesiaDatasetDescriptor,
  loadIndonesiaDataset,
  supportedIndonesiaAdminLevels
} from "../src/index.js";

describe("@territory-kit/data-id", () => {
  it("describes a thin resolver-driven country loader", async () => {
    expect(indonesiaDatasetDescriptor).toMatchObject({
      countryCodeAlpha2: "ID",
      countryCodeAlpha3: "IDN",
      packageName: "@territory-kit/data-id",
      requiresResolver: true
    });
    expect(supportedIndonesiaAdminLevels).toEqual(["ADM0", "ADM1", "ADM2"]);
    await expect(loadIndonesiaDataset({})).rejects.toThrow("does not embed geometry artifacts");
  });
});
