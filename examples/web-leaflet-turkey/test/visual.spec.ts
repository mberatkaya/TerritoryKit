import { expect, test } from "@playwright/test";

test("renders fixture territories and switches levels on Leaflet", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#map")).toBeVisible();
  await page.waitForFunction(() => window.__territoryKitLeafletDemo?.ready === true);

  await expect(page.locator("#status")).toContainText("visible territories");
  await expect(page.locator(".leaflet-overlay-pane svg path").first()).toBeVisible();

  const initial = await page.evaluate(() => ({
    renderedLevel: window.__territoryKitLeafletDemo?.renderedLevel,
    zoneCount: window.__territoryKitLeafletDemo?.lastZoneCount
  }));
  expect(initial).toMatchObject({ renderedLevel: "ADM1" });
  expect(initial.zoneCount).toBeGreaterThan(0);

  const district = await page.evaluate(() => window.__territoryKitLeafletDemo?.setZoom(8));
  expect(district).toMatchObject({ renderedLevel: "ADM2" });
  expect(district?.zoneCount).toBeGreaterThan(0);

  const neighbourhood = await page.evaluate(() => window.__territoryKitLeafletDemo?.setZoom(11));
  expect(neighbourhood).toMatchObject({ renderedLevel: "ADM3" });
  expect(neighbourhood?.zoneCount).toBeGreaterThan(0);

  const disposed = await page.evaluate(() => window.__territoryKitLeafletDemo?.dispose());
  expect(disposed).toBe(true);
});

interface TerritoryKitLeafletDemoProbe {
  lastZoneCount: number;
  ready: boolean;
  renderedLevel: string;
  dispose(): boolean;
  setZoom(zoom: number): Promise<{ renderedLevel: string; zoneCount: number }>;
}

declare global {
  interface Window {
    __territoryKitLeafletDemo?: TerritoryKitLeafletDemoProbe;
  }
}
