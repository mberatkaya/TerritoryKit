import { describe, expect, it } from "vitest";
import {
  japanDatasetDescriptor,
  loadJapanDataset,
  supportedJapanAdminLevels
} from "../src/index.js";

describe("@territory-kit/data-jp", () => {
  it("describes a thin resolver-driven country loader", async () => {
    expect(japanDatasetDescriptor).toMatchObject({
      countryCodeAlpha2: "JP",
      countryCodeAlpha3: "JPN",
      packageName: "@territory-kit/data-jp",
      requiresResolver: true
    });
    expect(supportedJapanAdminLevels).toEqual(["ADM0", "ADM1", "ADM2"]);
    await expect(loadJapanDataset({})).rejects.toThrow("does not embed geometry artifacts");
  });
});
