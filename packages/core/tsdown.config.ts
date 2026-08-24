import { defineConfig } from "tsdown";

export default defineConfig({
  clean: true,
  dts: true,
  entry: ["src/index.ts", "src/legacy-registry.ts"],
  deps: {
    neverBundle: ["@territory-kit/dataset", "@territory-kit/registry", "flatbush"]
  },
  format: ["esm", "cjs"],
  sourcemap: true,
  treeshake: true,
  unbundle: true
});
