import { expect, test } from "@playwright/test";

test("renders fixture territories and switches levels on OpenLayers", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#map")).toBeVisible();
  await page.waitForFunction(() => window.__territoryKitOpenLayersDemo?.ready === true);

  await expect(page.locator("#status")).toContainText("visible territories");
  await expect(page.locator(".ol-layer canvas").first()).toBeVisible();

  const initial = await page.evaluate(() => ({
    renderedLevel: window.__territoryKitOpenLayersDemo?.renderedLevel,
    zoneCount: window.__territoryKitOpenLayersDemo?.lastZoneCount
  }));
  expect(initial).toMatchObject({ renderedLevel: "ADM1" });
  expect(initial.zoneCount).toBeGreaterThan(0);

  const district = await page.evaluate(() => window.__territoryKitOpenLayersDemo?.setZoom(8));
  expect(district).toMatchObject({ renderedLevel: "ADM2" });
  expect(district?.zoneCount).toBeGreaterThan(0);

  const neighbourhood = await page.evaluate(() => window.__territoryKitOpenLayersDemo?.setZoom(11));
  expect(neighbourhood).toMatchObject({ renderedLevel: "ADM3" });
  expect(neighbourhood?.zoneCount).toBeGreaterThan(0);

  const disposed = await page.evaluate(() => window.__territoryKitOpenLayersDemo?.dispose());
  expect(disposed).toBe(true);
});

interface TerritoryKitOpenLayersDemoProbe {
  lastZoneCount: number;
  ready: boolean;
  renderedLevel: string;
  dispose(): boolean;
  setZoom(zoom: number): Promise<{ renderedLevel: string; zoneCount: number }>;
}

declare global {
  interface Window {
    __territoryKitOpenLayersDemo?: TerritoryKitOpenLayersDemoProbe;
  }
}
