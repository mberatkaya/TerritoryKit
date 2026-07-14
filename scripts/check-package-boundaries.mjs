import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";

const root = process.cwd();

const sourceRules = [
  {
    packageDir: "packages/dataset",
    allowed: new Set([]),
    description: "@territory-kit/dataset must stay independent from other workspace packages"
  },
  {
    packageDir: "packages/core",
    allowed: new Set(["@territory-kit/dataset"]),
    description: "@territory-kit/core may depend only on dataset workspace APIs"
  },
  {
    packageDir: "packages/generators",
    allowed: new Set(["@territory-kit/core", "@territory-kit/dataset"]),
    description: "@territory-kit/generators may depend on core and dataset only"
  },
  {
    packageDir: "packages/maplibre",
    allowed: new Set(["@territory-kit/core", "@territory-kit/dataset"]),
    description: "@territory-kit/maplibre may depend on core and dataset only"
  },
  {
    packageDir: "packages/nestjs",
    allowed: new Set(["@territory-kit/core", "@territory-kit/dataset"]),
    description: "@territory-kit/nestjs may depend on core and dataset only"
  },
  {
    packageDir: "packages/cli",
    allowed: new Set([
      "@territory-kit/core",
      "@territory-kit/dataset",
      "@territory-kit/generators"
    ]),
    description: "@territory-kit/cli may depend on core, dataset, and generators only"
  },
  {
    packageDir: "packages/shared-testkit",
    allowed: new Set(["@territory-kit/dataset"]),
    description: "@territory-kit/shared-testkit may depend on dataset only"
  }
];

const failures = [];

for (const rule of sourceRules) {
  const packagePath = join(root, rule.packageDir);
  const packageJsonPath = join(packagePath, "package.json");
  const srcPath = join(packagePath, "src");

  checkPackageManifest(rule, packageJsonPath);

  if (existsSync(srcPath)) {
    checkSourceImports(rule, srcPath);
  }
}

if (failures.length > 0) {
  console.error(
    ["Package boundary check failed:", ...failures.map((failure) => `- ${failure}`)].join("\n")
  );
  process.exit(1);
}

console.log("Package boundary check passed.");

function checkPackageManifest(rule, packageJsonPath) {
  const manifest = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const dependencySections = [
    ["dependencies", manifest.dependencies ?? {}],
    ["peerDependencies", manifest.peerDependencies ?? {}]
  ];

  for (const [sectionName, dependencies] of dependencySections) {
    for (const packageName of Object.keys(dependencies)) {
      if (packageName.startsWith("@territory-kit/") && !rule.allowed.has(packageName)) {
        failures.push(
          `${rule.packageDir}/package.json ${sectionName} declares ${packageName}; ${rule.description}.`
        );
      }
    }
  }
}

function checkSourceImports(rule, directory) {
  for (const filePath of listFiles(directory)) {
    if (![".ts", ".tsx"].includes(extname(filePath))) {
      continue;
    }

    const source = readFileSync(filePath, "utf8");
    const imports = [
      ...source.matchAll(/(?:from\s+|import\s*\(\s*)["'](@territory-kit\/[^"']+)["']/g)
    ];

    for (const match of imports) {
      const packageName = match[1];

      if (!rule.allowed.has(packageName)) {
        failures.push(`${relative(root, filePath)} imports ${packageName}; ${rule.description}.`);
      }
    }
  }
}

function listFiles(directory) {
  const entries = readdirSync(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...listFiles(entryPath));
    } else {
      files.push(entryPath);
    }
  }

  return files;
}
