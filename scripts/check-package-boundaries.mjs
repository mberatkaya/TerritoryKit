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
    packageDir: "packages/adapter-core",
    allowed: new Set(["@territory-kit/dataset"]),
    description: "@territory-kit/adapter-core may depend only on dataset workspace APIs"
  },
  {
    packageDir: "packages/registry",
    allowed: new Set(["@territory-kit/dataset"]),
    description: "@territory-kit/registry may depend only on dataset workspace APIs"
  },
  {
    packageDir: "packages/core",
    allowed: new Set(["@territory-kit/dataset", "@territory-kit/registry"]),
    compatibilityImports: new Map([
      ["@territory-kit/registry", new Set(["packages/core/src/legacy-registry.ts"])]
    ]),
    description: "@territory-kit/core may depend only on dataset and registry workspace APIs"
  },
  {
    packageDir: "packages/runtime",
    allowed: new Set([
      "@territory-kit/adapter-core",
      "@territory-kit/core",
      "@territory-kit/dataset",
      "@territory-kit/registry"
    ]),
    description:
      "@territory-kit/runtime may coordinate adapter-core, core, dataset, and registry only"
  },
  {
    packageDir: "packages/generators",
    allowed: new Set(["@territory-kit/core", "@territory-kit/dataset"]),
    description: "@territory-kit/generators may depend on core and dataset only"
  },
  ...["data-tr", "data-us", "data-de", "data-jp", "data-id"].map((packageName) => ({
    packageDir: `packages/${packageName}`,
    allowed: new Set(["@territory-kit/core"]),
    description: `@territory-kit/${packageName} may depend only on core workspace APIs`
  })),
  {
    packageDir: "packages/maplibre",
    allowed: new Set([
      "@territory-kit/adapter-core",
      "@territory-kit/dataset",
      "@territory-kit/registry"
    ]),
    description: "@territory-kit/maplibre may depend on adapter-core, dataset, and registry only"
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
      "@territory-kit/generators",
      "@territory-kit/registry",
      "@territory-kit/registry/node"
    ]),
    description: "@territory-kit/cli may depend on core, dataset, generators, and registry only"
  },
  {
    packageDir: "packages/shared-testkit",
    allowed: new Set(["@territory-kit/dataset"]),
    description: "@territory-kit/shared-testkit may depend on dataset only"
  }
];

const browserSafePackages = new Set([
  "packages/adapter-core",
  "packages/core",
  "packages/dataset",
  "packages/maplibre",
  "packages/runtime"
]);

const failures = [];

for (const rule of sourceRules) {
  const packagePath = join(root, rule.packageDir);
  const packageJsonPath = join(packagePath, "package.json");
  const srcPath = join(packagePath, "src");

  checkPackageManifest(rule, packageJsonPath);

  if (existsSync(srcPath)) {
    checkSourceImports(rule, srcPath);
    checkBrowserSafeImports(rule, srcPath);
  }
}

checkWorkspaceDependencyCycles(sourceRules);

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
        continue;
      }

      const compatibilityImports = rule.compatibilityImports?.get(packageName);

      if (compatibilityImports && !compatibilityImports.has(relative(root, filePath))) {
        failures.push(
          `${relative(root, filePath)} imports ${packageName}; ${packageName} is allowed in ${rule.packageDir} only through its documented compatibility entrypoint.`
        );
      }
    }
  }
}

function checkBrowserSafeImports(rule, directory) {
  if (!browserSafePackages.has(rule.packageDir)) {
    return;
  }

  for (const filePath of listFiles(directory)) {
    if (![".ts", ".tsx"].includes(extname(filePath))) {
      continue;
    }

    const source = readFileSync(filePath, "utf8");
    const nodeImports = [...source.matchAll(/(?:from\s+|import\s*\(\s*)["'](node:[^"']+)["']/g)];

    for (const match of nodeImports) {
      failures.push(
        `${relative(root, filePath)} imports ${match[1]}; ${rule.packageDir} must stay browser-safe.`
      );
    }
  }
}

function checkWorkspaceDependencyCycles(rules) {
  const packageNameByDir = new Map();
  const graph = new Map();

  for (const rule of rules) {
    const manifest = JSON.parse(readFileSync(join(root, rule.packageDir, "package.json"), "utf8"));
    packageNameByDir.set(rule.packageDir, manifest.name);
  }

  const workspaceNames = new Set(packageNameByDir.values());

  for (const rule of rules) {
    const manifest = JSON.parse(readFileSync(join(root, rule.packageDir, "package.json"), "utf8"));
    const dependencies = {
      ...(manifest.dependencies ?? {}),
      ...(manifest.peerDependencies ?? {})
    };
    graph.set(
      manifest.name,
      Object.keys(dependencies)
        .filter((dependency) => workspaceNames.has(dependency))
        .sort()
    );
  }

  const visiting = new Set();
  const visited = new Set();

  for (const packageName of graph.keys()) {
    visit(packageName, []);
  }

  function visit(packageName, path) {
    if (visited.has(packageName)) {
      return;
    }

    if (visiting.has(packageName)) {
      const cycleStart = path.indexOf(packageName);
      const cycle = [...path.slice(cycleStart), packageName].join(" -> ");
      failures.push(`Circular workspace dependency detected: ${cycle}.`);
      return;
    }

    visiting.add(packageName);

    for (const dependency of graph.get(packageName) ?? []) {
      visit(dependency, [...path, packageName]);
    }

    visiting.delete(packageName);
    visited.add(packageName);
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
