import { defineConfig } from "tsdown";

export default defineConfig({
  clean: true,
  dts: true,
  entry: ["src/index.ts"],
  external: [
    "@territory-kit/adapter-core",
    "@territory-kit/core",
    "@territory-kit/dataset",
    "@territory-kit/registry"
  ],
  format: ["esm", "cjs"],
  sourcemap: true,
  treeshake: true
});
