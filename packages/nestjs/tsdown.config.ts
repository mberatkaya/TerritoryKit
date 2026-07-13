import { defineConfig } from "tsdown";

export default defineConfig({
  clean: true,
  dts: true,
  entry: ["src/index.ts"],
  external: ["@nestjs/common", "@territory-kit/core", "@territory-kit/dataset", "rxjs"],
  format: ["esm", "cjs"],
  sourcemap: true,
  treeshake: true
});
