import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const registry = "https://registry.npmjs.org/";
const dryRun = process.argv.includes("--dry-run");

if (process.env.NODE_AUTH_TOKEN === "") {
  delete process.env.NODE_AUTH_TOKEN;
}

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
    ...options
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
};

const runJson = (command, args) => {
  return JSON.parse(
    execFileSync(command, args, {
      cwd: repoRoot,
      encoding: "utf8",
      env: process.env
    })
  );
};

const getWorkspacePackages = () => {
  const packages = runJson("pnpm", ["list", "--recursive", "--depth", "-1", "--json"]);

  return packages
    .filter((pkg) => pkg.name && pkg.version && pkg.private === false)
    .map((pkg) => ({
      ...pkg,
      packageJson: JSON.parse(readFileSync(path.join(pkg.path, "package.json"), "utf8"))
    }));
};

const isVersionPublished = ({ name, version }) => {
  const result = spawnSync(
    "npm",
    ["view", `${name}@${version}`, "version", `--registry=${registry}`],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: process.env
    }
  );

  if (result.status === 0) {
    return true;
  }

  if (`${result.stderr}\n${result.stdout}`.includes("E404")) {
    return false;
  }

  process.stderr.write(result.stderr);
  process.stdout.write(result.stdout);
  throw new Error(`Could not query npm for ${name}@${version}`);
};

const dependencyNames = (packageJson) => {
  return new Set([
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.peerDependencies ?? {}),
    ...Object.keys(packageJson.optionalDependencies ?? {})
  ]);
};

const orderForPublish = (packages) => {
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
  const visited = new Set();
  const visiting = new Set();
  const ordered = [];

  const visit = (pkg) => {
    if (visited.has(pkg.name)) {
      return;
    }

    if (visiting.has(pkg.name)) {
      throw new Error(`Circular publish dependency detected at ${pkg.name}`);
    }

    visiting.add(pkg.name);

    for (const dependencyName of dependencyNames(pkg.packageJson)) {
      const dependency = byName.get(dependencyName);

      if (dependency) {
        visit(dependency);
      }
    }

    visiting.delete(pkg.name);
    visited.add(pkg.name);
    ordered.push(pkg);
  };

  for (const pkg of packages) {
    visit(pkg);
  }

  return ordered;
};

const packPackage = (pkg, packRoot) => {
  const destination = path.join(packRoot, pkg.name.replaceAll("/", "-").replaceAll("@", ""));

  run("pnpm", ["--filter", pkg.name, "pack", "--pack-destination", destination]);

  const tarballs = readdirSync(destination)
    .filter((file) => file.endsWith(".tgz"))
    .map((file) => path.join(destination, file));

  if (tarballs.length !== 1) {
    throw new Error(`Expected exactly one tarball for ${pkg.name}, found ${tarballs.length}`);
  }

  return tarballs[0];
};

const publishTarball = (pkg, tarball) => {
  const args = [
    "publish",
    tarball,
    "--access",
    "public",
    "--tag",
    "latest",
    `--registry=${registry}`
  ];

  if (dryRun) {
    console.log(`[dry-run] npm ${args.join(" ")}`);
    return;
  }

  run("npm", args);
  console.log(`Published ${pkg.name}@${pkg.version}`);
};

const main = () => {
  const packagesToPublish = orderForPublish(
    getWorkspacePackages().filter((pkg) => !isVersionPublished(pkg))
  );

  if (packagesToPublish.length === 0) {
    console.log("No unpublished public packages found.");
    return;
  }

  console.log(
    `Publishing ${packagesToPublish.length} package${packagesToPublish.length === 1 ? "" : "s"}: ${packagesToPublish
      .map((pkg) => `${pkg.name}@${pkg.version}`)
      .join(", ")}`
  );

  const packRoot = mkdtempSync(path.join(tmpdir(), "territory-kit-pack-"));

  try {
    for (const pkg of packagesToPublish) {
      const tarball = packPackage(pkg, packRoot);
      publishTarball(pkg, tarball);
    }
  } finally {
    rmSync(packRoot, { recursive: true, force: true });
  }
};

main();
