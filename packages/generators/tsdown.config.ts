import { defineConfig } from "tsdown";

export default defineConfig({
  clean: true,
  dts: true,
  entry: ["src/index.ts"],
  external: ["@territory-kit/dataset", "@maplibre/geojson-vt", "@maplibre/vt-pbf"],
  format: ["esm", "cjs"],
  platform: "node",
  sourcemap: true,
  treeshake: true
});
