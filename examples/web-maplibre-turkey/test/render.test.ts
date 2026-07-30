import { describe, expect, it } from "vitest";
import { createDefaultMapStyle } from "../src/render.js";
import { demoLevelForZoom, zoomForDemoLevel } from "../src/levels.js";

describe("turkey live demo render helpers", () => {
  it("uses a token-free default MapLibre style", () => {
    const style = createDefaultMapStyle();

    expect(style.sources).toEqual({});
    expect(style.layers).toHaveLength(1);
    expect(JSON.stringify(style)).not.toContain("token");
  });

  it("maps zoom levels to ADM1, ADM2 and ADM3", () => {
    expect(demoLevelForZoom(5)).toBe("ADM1");
    expect(demoLevelForZoom(9)).toBe("ADM2");
    expect(demoLevelForZoom(12)).toBe("ADM3");
    expect(zoomForDemoLevel("ADM3")).toBeGreaterThan(12);
  });
});
