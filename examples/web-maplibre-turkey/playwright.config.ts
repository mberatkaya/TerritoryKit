import { defineConfig } from "@playwright/test";

const localPlayable = process.env.PW_LOCAL_PLAYABLE === "1";
const port = localPlayable ? 4176 : 4175;
const origin = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./test",
  testMatch: /.*\.spec\.ts/,
  outputDir: "./test-results",
  workers: localPlayable ? 1 : undefined,
  fullyParallel: !localPlayable,
  webServer: {
    command: localPlayable
      ? `VITE_TERRITORY_DEMO_MODE=local-playable VITE_TERRITORY_LOCAL_DEV_ORIGIN=${origin} pnpm exec vite --host 127.0.0.1 --port ${port}`
      : `pnpm dev --host 127.0.0.1 --port ${port}`,
    url: origin,
    reuseExistingServer: true
  },
  use: {
    baseURL: origin,
    viewport: { width: 1280, height: 820 }
  },
  ...(localPlayable
    ? {
        projects: [
          {
            name: "local-playable",
            testMatch: /local-playable-national\.spec\.ts/
          }
        ]
      }
    : {})
});
