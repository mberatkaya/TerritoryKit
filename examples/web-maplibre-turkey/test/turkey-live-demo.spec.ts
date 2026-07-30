import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#map")).toBeVisible();
  await page.waitForFunction(() => {
    return (window as WindowWithTurkeyDemo).__territoryKitTurkeyDemo?.ready === true;
  });
});

test("opens the map and shows dataset metadata", async ({ page }) => {
  await expect(page.locator("canvas").first()).toBeVisible();
  await expect(page.locator("#metadata-grid")).toContainText("territorykit-tr-adm3-demo");
  await expect(page.locator("#metadata-grid")).toContainText("synthetic-demo");
  await expect(page.locator("#runtime-grid")).toContainText("fixture");
  await expect(page.locator("#fallback-panel")).toContainText("not a production deployment claim");
});

test("selects ADM1 and ADM2 territories from the map", async ({ page }) => {
  await clickTerritory(page, "tr:adm1:istanbul", "ADM1");
  await expect(page.locator("#selection-panel")).toContainText("İstanbul");
  await expect(page.locator("#relationship-panel")).toContainText("Fatih");

  await page.evaluate(async () => {
    await (window as WindowWithTurkeyDemo).__territoryKitTurkeyDemo?.setZoom(9.2);
  });
  await clickTerritory(page, "tr:adm2:fatih", "ADM2");
  await expect(page.locator("#selection-panel")).toContainText("Fatih");
  await expect(page.locator("#relationship-panel")).toContainText("Demo Neighbourhood");
});

test("search, coordinate lookup and URL state work", async ({ page }) => {
  await page.locator("#territory-search").fill("Fatih");
  await expect(page.locator("#search-results .result-button")).toContainText("Fatih");
  await page.locator("#search-results .result-button").first().click();
  await expect(page.locator("#selection-panel")).toContainText("tr:adm2:fatih");

  const urlState = await page.evaluate(() => {
    return (window as WindowWithTurkeyDemo).__territoryKitTurkeyDemo?.getUrlState() ?? "";
  });
  expect(urlState).toContain("territory=tr%3Aadm2%3Afatih");

  await page.reload();
  await page.waitForFunction(() => {
    return (
      (window as WindowWithTurkeyDemo).__territoryKitTurkeyDemo?.selectedTerritoryId ===
      "tr:adm2:fatih"
    );
  });
  await expect(page.locator("#selection-panel")).toContainText("Fatih");

  await page.locator("#longitude-input").fill("28.965");
  await page.locator("#latitude-input").fill("41.03");
  await page.evaluate(async () => {
    await (window as WindowWithTurkeyDemo).__territoryKitTurkeyDemo?.setZoom(12.6);
  });
  await page.locator("#locate-button").click();
  await expect(page.locator("#locate-status")).toContainText("Demo Neighbourhood");
});

test("shows registry configuration errors and ADM3 fallback warning", async ({ page }) => {
  await page.goto("/?mode=registry");
  await page.waitForFunction(() => {
    return (window as WindowWithTurkeyDemo).__territoryKitTurkeyDemo?.ready === true;
  });
  await expect(page.locator("#fallback-panel")).toContainText("VITE_TERRITORY_REGISTRY_URL");
  await expect(page.locator("#mode-badge")).toContainText("Fixture fallback");

  await page.evaluate(async () => {
    await (window as WindowWithTurkeyDemo).__territoryKitTurkeyDemo?.setZoom(12.6);
  });
  await expect(page.locator("#adm3-warning")).toContainText("ADM3 is partial");
  await expect(page.locator("#fallback-panel")).toContainText("ADM3 coverage is partial");
});

test("has keyboard-accessible controls and stable visual output", async ({ page }) => {
  await expect(page.locator("#territory-search")).toHaveAccessibleName("İl veya ilçe ara");
  await page.keyboard.press("Tab");
  const focusedTag = await page.evaluate(() => document.activeElement?.tagName);
  expect(focusedTag).toBeTruthy();

  const unnamedControls = await page.locator("button, input").evaluateAll((controls) =>
    controls
      .filter((control) => {
        const label = control.getAttribute("aria-label") ?? control.textContent ?? "";
        const id = control.getAttribute("id");
        const hasExternalLabel = id ? Boolean(document.querySelector(`label[for="${id}"]`)) : false;
        const hasWrappingLabel = Boolean(control.closest("label"));
        return label.trim().length === 0 && !hasExternalLabel && !hasWrappingLabel;
      })
      .map((control) => control.outerHTML)
  );
  expect(unnamedControls).toEqual([]);

  await expect(page).toHaveScreenshot("turkey-live-demo-fixture.png", {
    animations: "disabled",
    maxDiffPixelRatio: 0.04
  });
});

test("stays within the browser performance smoke budget", async ({ page }) => {
  const frameRate = await page.evaluate(async () => {
    return (
      (await (window as WindowWithTurkeyDemo).__territoryKitTurkeyDemo?.estimateFrameRate(500)) ?? 0
    );
  });
  const metrics = await page.evaluate(() => {
    const probe = (window as WindowWithTurkeyDemo).__territoryKitTurkeyDemo;
    return {
      loadMs: probe?.loadMs ?? Number.POSITIVE_INFINITY,
      displayedFeatureCount: probe?.displayedFeatureCount ?? Number.POSITIVE_INFINITY
    };
  });

  expect(frameRate).toBeGreaterThanOrEqual(45);
  expect(metrics.loadMs).toBeLessThan(1_500);
  expect(metrics.displayedFeatureCount).toBeLessThanOrEqual(120);
});

async function clickTerritory(
  page: import("@playwright/test").Page,
  territoryId: string,
  level: DemoAdminLevel
): Promise<void> {
  await page.evaluate(
    async ([id, territoryLevel]) => {
      await (window as WindowWithTurkeyDemo).__territoryKitTurkeyDemo?.focusTerritory(
        id,
        territoryLevel
      );
    },
    [territoryId, level] as const
  );
  const point = await page.evaluate(
    async ([id, territoryLevel]) => {
      return (window as WindowWithTurkeyDemo).__territoryKitTurkeyDemo?.projectTerritoryCenter(
        id,
        territoryLevel
      );
    },
    [territoryId, level] as const
  );
  if (!point) {
    throw new Error(`Could not project ${territoryId}.`);
  }

  await page.locator("canvas").first().click({ position: point });
  await page.waitForFunction((expected) => {
    return (
      (window as WindowWithTurkeyDemo).__territoryKitTurkeyDemo?.selectedTerritoryId === expected
    );
  }, territoryId);
}

type DemoAdminLevel = "ADM1" | "ADM2" | "ADM3";

interface TurkeyDemoProbe {
  readonly ready: boolean;
  readonly selectedTerritoryId: string | undefined;
  readonly displayedFeatureCount: number;
  readonly loadMs: number;
  estimateFrameRate(durationMs?: number): Promise<number>;
  focusTerritory(territoryId: string, level?: DemoAdminLevel): Promise<boolean>;
  getUrlState(): string;
  projectTerritoryCenter(
    territoryId: string,
    level?: DemoAdminLevel
  ): Promise<{ x: number; y: number } | undefined>;
  setZoom(zoom: number): Promise<{ renderedLevel: DemoAdminLevel; displayedFeatureCount: number }>;
}

interface WindowWithTurkeyDemo extends Window {
  __territoryKitTurkeyDemo?: TurkeyDemoProbe;
}
