import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.VITE_TERRITORY_BASE_PATH ?? process.env.BASE_PATH ?? "/"
});
