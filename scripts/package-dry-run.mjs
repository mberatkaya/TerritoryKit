#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const packagesRoot = join(root, "packages");
const tempDir = await mkdtemp(join(tmpdir(), "territory-kit-pack-audit-"));
const results = [];

try {
  for (const packageDir of await findPublicPackageDirs()) {
    const packageJson = JSON.parse(await readFile(join(packageDir, "package.json"), "utf8"));
    const destination = join(tempDir, packageJson.name.replaceAll("@", "").replaceAll("/", "-"));
    const result = spawnSync(
      "pnpm",
      ["--filter", packageJson.name, "pack", "--pack-destination", destination],
      {
        cwd: root,
        encoding: "utf8",
        shell: process.platform === "win32"
      }
    );

    if (result.status !== 0) {
      process.stdout.write(result.stdout);
      process.stderr.write(result.stderr);
      process.exit(result.status ?? 1);
    }

    const tarball = (await readdir(destination))
      .filter((entry) => entry.endsWith(".tgz"))
      .sort()
      .at(-1);

    if (!tarball) {
      throw new Error(`No tarball was created for ${packageJson.name}.`);
    }

    const tarballPath = join(destination, tarball);
    const entries = listTarballEntries(tarballPath);
    const issues = auditTarball(packageJson.name, entries);
    results.push({
      package: packageJson.name,
      tarball,
      fileCount: entries.length,
      ok: issues.length === 0,
      issues
    });
  }
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

const ok = results.every((result) => result.ok);
console.log(JSON.stringify({ ok, packages: results }, null, 2));

if (!ok) {
  process.exit(1);
}

async function findPublicPackageDirs() {
  const entries = await readdir(packagesRoot, { withFileTypes: true });
  const packageDirs = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const packageDir = join(packagesRoot, entry.name);

    try {
      const packageJson = JSON.parse(await readFile(join(packageDir, "package.json"), "utf8"));

      if (!packageJson.private) {
        packageDirs.push(packageDir);
      }
    } catch {
      // Ignore workspace folders without package manifests.
    }
  }

  return packageDirs.sort();
}

function listTarballEntries(tarballPath) {
  const result = spawnSync("tar", ["-tf", tarballPath], {
    encoding: "utf8",
    shell: process.platform === "win32"
  });

  if (result.status !== 0) {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    throw new Error(`Could not list tarball contents for ${tarballPath}.`);
  }

  return result.stdout
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .sort();
}

function auditTarball(packageName, entries) {
  const issues = [];
  const entrySet = new Set(entries);
  const requiredFiles = ["package/package.json", "package/README.md", "package/LICENSE"];

  for (const file of requiredFiles) {
    if (!entrySet.has(file)) {
      issues.push(`${packageName} tarball is missing ${file}.`);
    }
  }

  for (const extension of [".mjs", ".cjs", ".d.mts", ".d.cts"]) {
    if (!entries.some((entry) => entry.startsWith("package/dist/") && entry.endsWith(extension))) {
      issues.push(`${packageName} tarball is missing a dist ${extension} file.`);
    }
  }

  const forbidden = entries.find((entry) =>
    [
      "package/src/",
      "package/test/",
      "package/coverage/",
      "package/node_modules/",
      "package/.turbo/"
    ].some((prefix) => entry.startsWith(prefix))
  );

  if (forbidden) {
    issues.push(`${packageName} tarball includes forbidden development file ${forbidden}.`);
  }

  return issues;
}
