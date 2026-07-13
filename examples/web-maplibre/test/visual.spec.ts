import { expect, test } from "@playwright/test";

test("renders TerritoryKit polygons on a MapLibre canvas", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#map")).toBeVisible();
  await expect(page.locator("canvas").first()).toBeVisible();
  await expect(page.locator("#status")).toContainText("Ready");
});
