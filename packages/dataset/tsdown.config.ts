import { defineConfig } from "tsdown";

export default defineConfig({
  clean: true,
  dts: true,
  entry: ["src/index.ts", "src/turkey-v2.ts"],
  format: ["esm", "cjs"],
  sourcemap: true,
  treeshake: true
});
