import { describe, expect, it } from "vitest";
import { readDemoConfig, readUrlState, validateRegistryUrl } from "../src/config.js";

describe("turkey live demo config", () => {
  it("uses fixture mode when no hosted registry URL is configured", () => {
    const config = readDemoConfig({}, new URLSearchParams());

    expect(config.mode).toBe("fixture");
    expect(config.requestedMode).toBe("auto");
    expect(config.datasetId).toBe("territory-kit-tr");
    expect(config.telemetryEnabled).toBe(false);
  });

  it("surfaces an explicit error for forced registry mode without a URL", () => {
    const config = readDemoConfig({ VITE_TERRITORY_DEMO_MODE: "registry" }, new URLSearchParams());

    expect(config.mode).toBe("fixture");
    expect(config.configError).toContain("VITE_TERRITORY_REGISTRY_URL");
  });

  it("enables registry mode and dataset version pinning from environment", () => {
    const config = readDemoConfig(
      {
        VITE_TERRITORY_REGISTRY_URL: "https://datasets.example.test/registry.json",
        VITE_TERRITORY_DATASET_VERSION: "1.2.3",
        VITE_MAP_STYLE_URL: "https://tiles.example.test/style.json"
      },
      new URLSearchParams()
    );

    expect(config.mode).toBe("registry");
    expect(config.datasetVersion).toBe("1.2.3");
    expect(config.datasetVersionPinned).toBe(true);
    expect(config.styleUrl).toBe("https://tiles.example.test/style.json");
  });

  it("reads selected territory URL state", () => {
    const state = readUrlState(
      new URLSearchParams("territory=tr%3Aadm1%3Aistanbul&level=ADM1&mode=fixture")
    );

    expect(state).toEqual({
      territoryId: "tr:adm1:istanbul",
      level: "ADM1",
      mode: "fixture"
    });
  });

  it("validates registry URL shape without requiring secrets", () => {
    expect(validateRegistryUrl("https://datasets.example.test/registry.json")).toBeUndefined();
    expect(validateRegistryUrl("file:///tmp/registry.json")).toContain("https:// or http://");
  });
});
