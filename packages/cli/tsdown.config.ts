import { defineConfig } from "tsdown";

export default defineConfig({
  clean: true,
  dts: true,
  entry: ["src/index.ts"],
  external: ["@territory-kit/core", "@territory-kit/dataset", "@territory-kit/generators"],
  format: ["esm", "cjs"],
  platform: "node",
  sourcemap: true,
  treeshake: true
});
