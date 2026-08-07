import { existsSync, readFileSync } from "node:fs";
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
const fixedGroupPackageJsonPaths = [
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
  "packages/game/package.json",
  "packages/maplibre/package.json",
  "packages/nestjs/package.json",
  "packages/registry/package.json",
  "packages/runtime/package.json"
] as const;

describe("release metadata", () => {
  it("keeps Sprint 11 through Sprint 13 documented on the 1.2.0 fixed-group minor release", () => {
    const rootPackage = readJson<PackageJson>("package.json");
    const changesetConfig = readJson<ChangesetConfig>(".changeset/config.json");
    const fixedPackages = new Set(changesetConfig.fixed.flat());
    const fixedGroupVersions = new Set<string>();

    expect(rootPackage.version).toBe("0.0.0-private");

    for (const packagePath of fixedGroupPackageJsonPaths) {
      const packageJson = readJson<PackageJson>(packagePath);

      fixedGroupVersions.add(packageJson.version);
      expect(packageJson.name ? fixedPackages.has(packageJson.name) : false).toBe(true);
    }

    expect(fixedGroupVersions.size).toBe(1);
    const [fixedGroupVersion] = fixedGroupVersions;
    if (fixedGroupVersion === undefined) {
      throw new Error("Expected at least one fixed-group package version.");
    }

    const readme = readText("README.md");
    expect(readText("CHANGELOG.md")).toContain("## 1.2.0");

    if (existsRelativePath(".changeset/runtime-architecture-boundaries.md")) {
      const sprintChangeset = readText(".changeset/runtime-architecture-boundaries.md");

      expect(fixedGroupVersion).toBe("1.1.0");
      expect(sprintChangeset).toContain('"@territory-kit/adapter-core": minor');
      expect(sprintChangeset).toContain('"@territory-kit/runtime": minor');
      expect(nextMinor(fixedGroupVersion)).toBe("1.2.0");
      expect(readme).toMatch(/\| Pending `1\.2\.0`\s+\| Sprint 11/);
      expect(readme).toMatch(/\| Pending `1\.2\.0`\s+\| Sprint 12/);
      expect(readme).toMatch(/\| Pending `1\.2\.0`\s+\| Sprint 13/);
      expect(readText("packages/adapter-core/CHANGELOG.md")).toContain("## 1.2.0 - Unreleased");
      expect(readText("packages/runtime/CHANGELOG.md")).toContain("## 1.2.0 - Unreleased");
      return;
    }

    expect(compareSemver(fixedGroupVersion, "1.2.0")).toBeGreaterThanOrEqual(0);
    expect(readme).toMatch(/\| `1\.2\.0`\s+\| Sprint 11/);
    expect(readme).toMatch(/\| `1\.2\.0`\s+\| Sprint 12/);
    expect(readme).toMatch(/\| `1\.2\.0`\s+\| Sprint 13/);
    expect(readText("packages/adapter-core/CHANGELOG.md")).toContain(
      "## 1.2.0\n\n### Minor Changes"
    );
    expect(readText("packages/runtime/CHANGELOG.md")).toContain("## 1.2.0\n\n### Minor Changes");
    expect(readText("packages/runtime/CHANGELOG.md")).toContain("Add Sprint 13 catalog");
  });
});

function readJson<T>(relativePath: string): T {
  return JSON.parse(readText(relativePath)) as T;
}

function readText(relativePath: string): string {
  return readFileSync(resolve(rootDirectory, relativePath), "utf8");
}

function existsRelativePath(relativePath: string): boolean {
  return existsSync(resolve(rootDirectory, relativePath));
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

function compareSemver(left: string, right: string): number {
  const leftParts = parseSemver(left);
  const rightParts = parseSemver(right);

  for (let index = 0; index < leftParts.length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);

    if (difference !== 0) {
      return difference;
    }
  }

  return 0;
}

function parseSemver(version: string): [number, number, number] {
  const parts = version.split(".").map(Number);

  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part) || part < 0)) {
    throw new Error(`Invalid semver version: ${version}`);
  }

  return parts as [number, number, number];
}
