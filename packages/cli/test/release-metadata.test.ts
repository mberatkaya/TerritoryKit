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
  it("keeps fixed-group versions Changesets-owned after the 2.0 handoff", () => {
    const rootPackage = readJson<PackageJson>("package.json");
    const changesetConfig = readJson<ChangesetConfig>(".changeset/config.json");
    const fixedPackages = new Set(
      changesetConfig.fixed.find((group) => group.includes("@territory-kit/cli")) ?? []
    );
    const fixedGroupVersions: string[] = [];
    const v2StableChangesetExists = existsRelativePath(".changeset/territorykit-v2-stable.md");

    expect(rootPackage.version).toBe("0.0.0-private");

    for (const packagePath of fixedGroupPackageJsonPaths) {
      const packageJson = readJson<PackageJson>(packagePath);

      fixedGroupVersions.push(packageJson.version);
      expect(packageJson.name ? fixedPackages.has(packageJson.name) : false).toBe(true);
    }

    const fixedGroupVersion = consistentReleaseVersion(fixedGroupVersions);

    const readme = readText("README.md");
    expect(readText("CHANGELOG.md")).toContain("## 2.0.0 - 2026-08-22");
    const publishedVersion = readme.match(
      /TerritoryKit `(\d+\.\d+\.\d+)` is the current npm sync release/
    )?.[1];
    expect(publishedVersion).toBeDefined();
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

    for (const packagePath of fixedGroupPackageJsonPaths) {
      const changelogPath = packagePath.replace("package.json", "CHANGELOG.md");
      expect(readText(changelogPath)).toContain(`## ${fixedGroupVersion}`);
    }
    for (const packageName of ["cli", "adapter-core", "runtime"]) {
      expect(readText(`packages/${packageName}/CHANGELOG.md`)).toContain("## 2.0.0");
      expect(readText(`packages/${packageName}/CHANGELOG.md`)).toContain(`## ${publishedVersion}`);
    }
  });

  it.each(["2.1.0", "3.0.0", "4.2.1"])(
    "accepts a consistent fixed-family release at %s",
    (version) => {
      expect(consistentReleaseVersion(Array(15).fill(version))).toBe(version);
      const otherVersion = version === "2.1.0" ? "3.0.0" : "2.1.0";
      expect(() => consistentReleaseVersion([version, otherVersion])).toThrow();
    }
  );

  it.each(["", "2.1", "v3.0.0", "03.0.0"])("rejects invalid release version %s", (version) => {
    expect(() => consistentReleaseVersion([version])).toThrow();
  });
});

function consistentReleaseVersion(versions: readonly string[]): string {
  const [version] = versions;
  if (version === undefined || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error(`Invalid fixed-family release version: ${version}`);
  }
  if (versions.some((candidate) => candidate !== version)) {
    throw new Error("Fixed-family package versions differ.");
  }
  return version;
}

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
