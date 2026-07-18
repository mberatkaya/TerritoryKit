import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

interface PackageJson {
  readonly name?: string;
  readonly version: string;
}

interface ChangesetConfig {
  readonly fixed: readonly (readonly string[])[];
}

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const publicPackageJsonPaths = [
  "packages/adapter-core/package.json",
  "packages/cli/package.json",
  "packages/core/package.json",
  "packages/data-de/package.json",
  "packages/data-id/package.json",
  "packages/data-jp/package.json",
  "packages/data-tr/package.json",
  "packages/data-us/package.json",
  "packages/dataset/package.json",
  "packages/generators/package.json",
  "packages/maplibre/package.json",
  "packages/nestjs/package.json",
  "packages/registry/package.json",
  "packages/runtime/package.json"
] as const;

describe("release metadata", () => {
  it("keeps Sprint 11 as the pending 1.2.0 fixed-group minor release", () => {
    const rootPackage = readJson<PackageJson>("package.json");
    const changesetConfig = readJson<ChangesetConfig>(".changeset/config.json");
    const fixedPackages = new Set(changesetConfig.fixed.flat());
    const sprintChangeset = readText(".changeset/runtime-architecture-boundaries.md");

    expect(rootPackage.version).toBe("0.0.0-private");

    for (const packagePath of publicPackageJsonPaths) {
      const packageJson = readJson<PackageJson>(packagePath);

      expect(packageJson.version).toBe("1.1.0");
      expect(packageJson.name ? fixedPackages.has(packageJson.name) : false).toBe(true);
    }

    expect(sprintChangeset).toContain('"@territory-kit/adapter-core": minor');
    expect(sprintChangeset).toContain('"@territory-kit/runtime": minor');
    expect(nextMinor("1.1.0")).toBe("1.2.0");

    expect(readText("README.md")).toContain("| `1.2.0`         | Sprint 11");
    expect(readText("CHANGELOG.md")).toContain("## 1.2.0 - Unreleased");
    expect(readText("packages/adapter-core/CHANGELOG.md")).toContain("## 1.2.0 - Unreleased");
    expect(readText("packages/runtime/CHANGELOG.md")).toContain("## 1.2.0 - Unreleased");
  });
});

function readJson<T>(relativePath: string): T {
  return JSON.parse(readText(relativePath)) as T;
}

function readText(relativePath: string): string {
  return readFileSync(resolve(rootDirectory, relativePath), "utf8");
}

function nextMinor(version: string): string {
  const [majorText, minorText] = version.split(".");
  const major = Number(majorText);
  const minor = Number(minorText);

  if (!Number.isInteger(major) || !Number.isInteger(minor)) {
    throw new Error(`Invalid semver version: ${version}`);
  }

  return `${major}.${minor + 1}.0`;
}
