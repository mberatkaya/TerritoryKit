import { defineConfig } from "tsdown";

export default defineConfig({
  clean: true,
  dts: true,
  entry: ["src/index.ts", "src/maplibre.ts"],
  external: [
    "@territory-kit/core",
    "@territory-kit/dataset",
    "@territory-kit/registry",
    "@maplibre/maplibre-react-native",
    "react",
    "react-native"
  ],
  format: ["esm", "cjs"],
  sourcemap: true,
  treeshake: true
});
