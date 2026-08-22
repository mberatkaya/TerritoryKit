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
  it("keeps fixed-group versions Changesets-owned through the 2.0 handoff", () => {
    const rootPackage = readJson<PackageJson>("package.json");
    const changesetConfig = readJson<ChangesetConfig>(".changeset/config.json");
    const fixedPackages = new Set(changesetConfig.fixed.flat());
    const fixedGroupVersions = new Set<string>();
    const v2StableChangesetExists = existsRelativePath(".changeset/territorykit-v2-stable.md");

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
    expect(readText("CHANGELOG.md")).toContain("## 2.0.0 - 2026-08-22");
    expect(readme).toContain("TerritoryKit `2.0.0` is the stable release target");
    expect(readme).toContain("`territory-kit-tr-v2-playable@2.0.0`");
    expect(readme).toMatch(/\| `1\.2\.0`\s+\| Sprint 11/);
    expect(readme).toMatch(/\| `1\.2\.0`\s+\| Sprint 12/);
    expect(readme).toMatch(/\| `1\.2\.0`\s+\| Sprint 13/);
    if (v2StableChangesetExists) {
      expect(fixedGroupVersion).toBe("1.9.3");
      expect(readme).toMatch(/Public package manifests\s+remain on the current `1\.9\.3`/);
      expect(nextMajor(fixedGroupVersion)).toBe("2.0.0");
      expect(readText(".changeset/territorykit-v2-stable.md")).toContain(
        '"@territory-kit/cli": major'
      );
      return;
    }

    expect(fixedGroupVersion).toBe("2.0.0");
    expect(readme).toMatch(
      /Public package manifests for\s+the fixed core family are versioned at `2\.0\.0`/
    );
    expect(readText("packages/cli/CHANGELOG.md")).toContain("## 2.0.0");
    expect(readText("packages/adapter-core/CHANGELOG.md")).toContain("## 2.0.0");
    expect(readText("packages/runtime/CHANGELOG.md")).toContain("## 2.0.0");
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

function nextMajor(version: string): string {
  const [majorText] = version.split(".");
  const major = Number(majorText);

  if (!Number.isInteger(major)) {
    throw new Error(`Invalid semver version: ${version}`);
  }

  return `${major + 1}.0.0`;
}
