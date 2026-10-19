import { describe, expect, it } from "vitest";
import {
  LOCAL_PLAYABLE_DATASET_ID,
  LOCAL_PLAYABLE_DATASET_VERSION,
  readDemoConfig,
  readUrlState,
  validateRegistryUrl
} from "../src/config.js";
import { DEFAULT_LOCAL_PLAYABLE_DEV_ORIGIN } from "../src/local-playable-urls.js";

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
    expect(validateRegistryUrl("/territory-candidate/registry.json")).toContain("absolute URL");
  });

  it("rejects bare relative local registry paths without a dev origin", () => {
    const config = readDemoConfig(
      { VITE_TERRITORY_DEMO_MODE: "local-playable" },
      new URLSearchParams(),
      { devOrigin: "" }
    );

    expect(config.requestedMode).toBe("local-playable");
    expect(config.mode).toBe("local-playable");
    expect(config.registryUrl).toBe("/territory-candidate/registry.json");
    expect(config.configError).toContain("absolute URL");
  });

  it("resolves default local-playable dev command URLs to absolute same-origin http", () => {
    const origin = "http://127.0.0.1:5173";
    const config = readDemoConfig(
      { VITE_TERRITORY_DEMO_MODE: "local-playable" },
      new URLSearchParams(),
      { devOrigin: origin }
    );

    expect(config.mode).toBe("local-playable");
    expect(config.configError).toBeUndefined();
    expect(config.registryUrl).toBe(`${origin}/territory-candidate/registry.json`);
    expect(config.deliveryManifestUrl).toBe(`${origin}/territory-candidate/delivery-manifest.json`);
    expect(config.smartCoverageUrl).toBe(`${origin}/territory-candidate/smart-coverage.json`);
    expect(config.datasetId).toBe(LOCAL_PLAYABLE_DATASET_ID);
    expect(config.datasetVersion).toBe(LOCAL_PLAYABLE_DATASET_VERSION);
    expect(DEFAULT_LOCAL_PLAYABLE_DEV_ORIGIN).toBe("http://127.0.0.1:5173");
  });
});
