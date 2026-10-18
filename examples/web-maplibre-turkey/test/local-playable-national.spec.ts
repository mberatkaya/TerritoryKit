import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const candidateRoot = path.join(repoRoot, ".territory/sprint-3/playable-v3/candidate");
const candidateReady = existsSync(path.join(candidateRoot, "registry.json"));

type VisualDistrict = {
  label: string;
  adm2Id: string;
  lng: number;
  lat: number;
  zoom: number;
  displayName?: string;
};

const VISUAL_DISTRICTS: VisualDistrict[] = [
  {
    label: "Fatih",
    adm2Id: "tr:adm2:54988432b39641834885080",
    lng: 28.9536,
    lat: 41.0143,
    zoom: 12.5
  },
  {
    label: "Eyüpsultan",
    adm2Id: "tr:adm2:54988432b93840376788897",
    lng: 28.8731,
    lat: 41.1653,
    zoom: 11.8
  },
  {
    label: "Kadıköy",
    adm2Id: "tr:adm2:54988432b89638439219394",
    lng: 29.063,
    lat: 40.9811,
    zoom: 12.4
  },
  {
    label: "Adalar",
    adm2Id: "tr:adm2:54988432b94516152709384",
    lng: 29.0587,
    lat: 40.8662,
    zoom: 12.2,
    displayName: "Prince Islands"
  },
  {
    label: "Çatalca",
    adm2Id: "tr:adm2:54988432b71345383711908",
    lng: 28.3328,
    lat: 41.3235,
    zoom: 10.8
  },
  {
    label: "Çankaya",
    adm2Id: "tr:adm2:54988432b72030220276956",
    lng: 32.8847,
    lat: 39.7982,
    zoom: 11.5
  },
  {
    label: "Konak",
    adm2Id: "tr:adm2:54988432b43742920895959",
    lng: 27.129,
    lat: 38.4219,
    zoom: 12.3
  },
  {
    label: "Muratpaşa",
    adm2Id: "tr:adm2:54988432b17723605206621",
    lng: 30.7634,
    lat: 36.8875,
    zoom: 12.1
  },
  {
    label: "Pervari",
    adm2Id: "tr:adm2:54988432b48183111476065",
    lng: 42.5072,
    lat: 37.8466,
    zoom: 11.2
  },
  {
    label: "Keçiborlu",
    adm2Id: "tr:adm2:54988432b38029735650586",
    lng: 30.2424,
    lat: 37.9122,
    zoom: 11.4
  }
];

async function ensureQueryIndex(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const demo = (window as WindowWithTurkeyDemo).__territoryKitTurkeyDemo;
    if (!demo) {
      throw new Error("Turkey demo is not ready");
    }
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const results = await demo.search("fatih");
      if (results.some((result) => result.level === "ADM2")) {
        return;
      }
      await sleep(500);
    }
    throw new Error("ADM2 query index did not become ready");
  });
}

async function selectFromSearch(
  page: Page,
  query: string,
  options: {
    preferName?: string;
    preferId?: string;
    level?: "ADM1" | "ADM2" | "ADM3";
  } = {}
): Promise<string> {
  const territoryId = await page.evaluate(
    async ({ query, preferName, preferId, level }) => {
      const demo = (window as WindowWithTurkeyDemo).__territoryKitTurkeyDemo;
      if (!demo) {
        throw new Error("Turkey demo is not ready");
      }

      const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
      let results: Array<{ id: string; name: string; level: "ADM1" | "ADM2" | "ADM3" }> = [];
      for (let attempt = 0; attempt < 30; attempt += 1) {
        results = await demo.search(query);
        if (results.length > 0) {
          break;
        }
        await sleep(250);
      }

      const match =
        results.find((result) => preferId !== undefined && result.id === preferId) ??
        results.find(
          (result) =>
            (preferName ? result.name === preferName : true) &&
            (level ? result.level === level : true)
        ) ??
        results.find((result) => (preferName ? result.name.includes(preferName) : false)) ??
        results[0];

      if (!match) {
        throw new Error(`No search results for "${query}"`);
      }

      await demo.selectTerritory(match.id, match.level);
      return match.id;
    },
    {
      query,
      preferName: options.preferName,
      preferId: options.preferId,
      level: options.level
    }
  );

  await expect(page.locator("#selection-panel")).toContainText(territoryId, { timeout: 60_000 });
  return territoryId;
}

test.describe("national local-playable map", () => {
  test.skip(!candidateReady, "requires pnpm data:tr:sprint4:playable-map:bootstrap locally");
  test.describe.configure({ mode: "serial" });
  test.setTimeout(180_000);

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => {
      return (window as WindowWithTurkeyDemo).__territoryKitTurkeyDemo?.ready === true;
    });
    await expect(page.locator("#mode-badge")).toContainText("Playable v3 (local)");
    await expect(page.locator("#mode-badge")).not.toContainText("Fixture");
    expect(
      await page.evaluate(() => (window as WindowWithTurkeyDemo).__territoryKitTurkeyDemo?.mode)
    ).toBe("local-playable");
    await ensureQueryIndex(page);
  });

  test("loads registry, delivery manifest, render geojson and MVT tiles", async ({ page }) => {
    const artifactStatus = await page.evaluate(async () => {
      const paths = [
        "/territory-candidate/registry.json",
        "/territory-candidate/delivery-manifest.json",
        "/territory-candidate/render/levels/ADM2.geojson"
      ];
      return Promise.all(paths.map((path) => fetch(path).then((res) => res.status)));
    });
    expect(artifactStatus).toEqual([200, 200, 200]);

    await page.evaluate(async (zoom) => {
      await (window as WindowWithTurkeyDemo).__territoryKitTurkeyDemo?.setZoom(zoom);
    }, 12.5);
    await page.waitForTimeout(1500);
    const tileProbe = await page.evaluate(async () => {
      const manifest = (await fetch("/territory-candidate/render/manifest.json").then((res) =>
        res.json()
      )) as { format?: string; layers?: Array<{ sourceLayer?: string }> };
      const tile = await fetch("/territory-candidate/render/tiles/10/585/386.mvt");
      return {
        manifestFormat: manifest.format,
        sourceLayer: manifest.layers?.[0]?.sourceLayer,
        tileStatus: tile.status,
        tileBytes: (await tile.arrayBuffer()).byteLength
      };
    });
    expect(tileProbe.manifestFormat).toBe("mvt");
    expect(tileProbe.sourceLayer).toBe("territory_adm3");
    expect(tileProbe.tileStatus).toBe(200);
    expect(tileProbe.tileBytes).toBeGreaterThan(0);
  });

  test("selects district and ADM3 with metadata", async ({ page }) => {
    await selectFromSearch(page, "fatih", { preferName: "Fatih", level: "ADM2" });
    await expect(page.locator("#selection-panel")).toContainText("tr:adm2:", { timeout: 30_000 });
    await page.evaluate(async () => {
      await (window as WindowWithTurkeyDemo).__territoryKitTurkeyDemo?.setZoom(12.8);
    });
    const adm3Id = await page.evaluate(async () => {
      return (window as WindowWithTurkeyDemo).__territoryKitTurkeyDemo?.locate(
        28.965,
        41.02,
        "ADM3"
      );
    });
    expect(adm3Id).toMatch(/^tr:adm3:/);
    await expect(page.locator("#selection-panel")).toContainText("Kararlı ID");
  });

  test("keeps map interaction with QA mode enabled", async ({ page }) => {
    const districtId = await selectFromSearch(page, "fatih", {
      preferName: "Fatih",
      level: "ADM2"
    });
    await page.locator("#qa-mode-toggle").check();
    await expect(page.locator("#map")).toBeVisible();
    await expect(page.locator("#selection-panel")).toContainText("tr:adm2:");
    const center = await page.evaluate(async (territoryId) => {
      return (window as WindowWithTurkeyDemo).__territoryKitTurkeyDemo?.projectTerritoryCenter(
        territoryId,
        "ADM2"
      );
    }, districtId);
    expect(center).toBeDefined();
    const mapBox = await page.locator("#map").boundingBox();
    expect(mapBox).toBeTruthy();
    const hoverX =
      center && center.x >= 0 && center.x <= mapBox!.width ? center.x : mapBox!.width / 2;
    const hoverY =
      center && center.y >= 0 && center.y <= mapBox!.height ? center.y : mapBox!.height / 2;
    await page.mouse.move(hoverX, hoverY);
    await page.waitForTimeout(200);
    await expect(page.locator("#map")).toBeVisible();
  });

  test("visual QA — ten sprint-4 locations", async ({ page }) => {
    for (const district of VISUAL_DISTRICTS) {
      await page.evaluate(
        async ({ lng, lat, zoom }) => {
          const demo = (window as WindowWithTurkeyDemo).__territoryKitTurkeyDemo;
          if (!demo) {
            throw new Error("Turkey demo is not ready");
          }
          await demo.flyToCoordinate(lng, lat, zoom);
        },
        { lng: district.lng, lat: district.lat, zoom: district.zoom }
      );
      await page.waitForTimeout(1500);
      await expect(page.locator("canvas").first()).toBeVisible();
      await page.screenshot({
        path: path.join(
          "test-results",
          "sprint4-visual",
          `${district.label.replace(/\s+/g, "-")}.png`
        ),
        fullPage: false
      });
    }
  });
});

interface WindowWithTurkeyDemo {
  __territoryKitTurkeyDemo?: {
    ready: boolean;
    mode: string;
    search(
      query: string
    ): Promise<Array<{ id: string; name: string; level: "ADM1" | "ADM2" | "ADM3" }>>;
    focusTerritory(territoryId: string, level: string): Promise<boolean>;
    selectTerritory(territoryId: string, level: string): Promise<string | undefined>;
    projectTerritoryCenter(
      territoryId: string,
      level: string
    ): Promise<{ x: number; y: number } | undefined>;
    flyToCoordinate(
      lng: number,
      lat: number,
      zoom: number
    ): Promise<{ renderedLevel: string; displayedFeatureCount: number }>;
    setZoom(zoom: number): Promise<{ renderedLevel: string; displayedFeatureCount: number }>;
    locate(lng: number, lat: number, level?: string): Promise<string | undefined>;
  };
}
