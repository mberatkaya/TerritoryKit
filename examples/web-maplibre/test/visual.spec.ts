import { expect, test } from "@playwright/test";

test("renders TerritoryKit polygons on a MapLibre canvas", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#map")).toBeVisible();
  const canvas = page.locator("canvas").first();

  await expect(canvas).toBeVisible();
  await expect(page.locator("#status")).toContainText("Ready");
  await page.waitForFunction(() => {
    const probe = (window as WindowWithTerritoryKitDemo).__territoryKitDemo;

    return probe?.ready === true && probe.attachCount === 1;
  });

  const initialZoneIds = await page.evaluate(() => {
    return (window as WindowWithTerritoryKitDemo).__territoryKitDemo?.lastVisibleZoneIds ?? [];
  });
  expect(initialZoneIds).toEqual(["tr:34:fatih", "tr:34:kadikoy"]);

  await page.waitForFunction((expectedZoneIds) => {
    const renderedZoneIds = new Set(
      (window as WindowWithTerritoryKitDemo).__territoryKitDemo?.queryRenderedZoneIds() ?? []
    );

    return expectedZoneIds.every((zoneId) => renderedZoneIds.has(zoneId));
  }, initialZoneIds);

  const renderedZoneIds = await page.evaluate(() => {
    return (window as WindowWithTerritoryKitDemo).__territoryKitDemo?.queryRenderedZoneIds() ?? [];
  });
  expect(new Set(renderedZoneIds)).toEqual(new Set(initialZoneIds));

  const parentZoomZoneIds = await page.evaluate(async () => {
    return (window as WindowWithTerritoryKitDemo).__territoryKitDemo?.setZoom(8) ?? [];
  });
  expect(parentZoomZoneIds).toEqual(["tr:34"]);

  const childZoomZoneIds = await page.evaluate(async () => {
    return (window as WindowWithTerritoryKitDemo).__territoryKitDemo?.setZoom(10) ?? [];
  });
  expect(childZoomZoneIds).toEqual(["tr:34:fatih", "tr:34:kadikoy"]);

  const clickPoint = await page.evaluate(() => {
    return (window as WindowWithTerritoryKitDemo).__territoryKitDemo?.projectZoneCenter(
      "tr:34:fatih"
    );
  });
  expect(clickPoint).toBeDefined();

  await canvas.click({ position: clickPoint });
  await page.waitForFunction(() => {
    return (
      (window as WindowWithTerritoryKitDemo).__territoryKitDemo?.lastClickedZoneId === "tr:34:fatih"
    );
  });
  await expect(page.locator("#status")).toContainText("tr:34:fatih");

  const hoverPoint = await page.evaluate(() => {
    return (window as WindowWithTerritoryKitDemo).__territoryKitDemo?.projectZoneCenter(
      "tr:34:kadikoy"
    );
  });
  expect(hoverPoint).toBeDefined();

  await canvas.hover({ position: hoverPoint });
  await page.waitForFunction(() => {
    return (
      (window as WindowWithTerritoryKitDemo).__territoryKitDemo?.lastHoveredZoneId ===
      "tr:34:kadikoy"
    );
  });

  const frameRate = await page.evaluate(async () => {
    return (window as WindowWithTerritoryKitDemo).__territoryKitDemo?.estimateFrameRate(500) ?? 0;
  });
  expect(frameRate).toBeGreaterThanOrEqual(55);
});

interface TerritoryKitDemoProbe {
  attachCount: number;
  estimateFrameRate(durationMs?: number): Promise<number>;
  lastClickedZoneId?: string;
  lastHoveredZoneId?: string;
  lastVisibleZoneIds: string[];
  projectZoneCenter(zoneId: string): { x: number; y: number } | undefined;
  queryRenderedZoneIds(): string[];
  ready: boolean;
  setZoom(zoom: number): Promise<string[]>;
}

interface WindowWithTerritoryKitDemo extends Window {
  __territoryKitDemo?: TerritoryKitDemoProbe;
}
