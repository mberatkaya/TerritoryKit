import { validateTurkeyV2Dataset } from "@territory-kit/dataset/turkey-v2";
import { describe, expect, it } from "vitest";
import { createTurkeyAdm3DemoDataset } from "../src/index.js";

describe("Turkey ADM3 synthetic demo fixture", () => {
  it("is rejected by the Turkey V2 production publish validation path", () => {
    const result = validateTurkeyV2Dataset(createTurkeyAdm3DemoDataset());

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "SYNTHETIC_SOURCE_NOT_PUBLISHABLE" })
      ])
    );
  });
});
