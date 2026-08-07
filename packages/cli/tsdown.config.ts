import { defineConfig } from "tsdown";

export default defineConfig({
  clean: true,
  dts: true,
  entry: ["src/index.ts"],
  external: [
    "@territory-kit/core",
    "@territory-kit/dataset",
    "@territory-kit/generators",
    "@territory-kit/generators/turkey-adm3"
  ],
  format: ["esm", "cjs"],
  platform: "node",
  sourcemap: true,
  treeshake: true
});
