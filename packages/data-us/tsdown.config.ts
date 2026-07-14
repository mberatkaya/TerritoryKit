import { defineConfig } from "tsdown";

export default defineConfig({
  clean: true,
  dts: true,
  entry: ["src/index.ts"],
  external: ["@territory-kit/core"],
  format: ["esm", "cjs"],
  sourcemap: true,
  treeshake: true
});
