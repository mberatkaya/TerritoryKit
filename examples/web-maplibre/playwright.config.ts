import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test",
  webServer: {
    command: "pnpm dev --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: true
  },
  use: {
    baseURL: "http://127.0.0.1:4173",
    viewport: { width: 1280, height: 800 }
  }
});
