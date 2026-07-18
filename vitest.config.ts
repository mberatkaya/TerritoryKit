import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "packages/*/test/**/*.test.ts", "examples/*/test/**/*.test.ts"],
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      include: [
        "packages/adapter-core/src/**/*.ts",
        "packages/core/src/**/*.ts",
        "packages/dataset/src/**/*.ts",
        "packages/runtime/src/**/*.ts"
      ],
      reporter: ["text", "json-summary"],
      thresholds: {
        branches: 75,
        functions: 85,
        lines: 85,
        statements: 85
      }
    }
  }
});
