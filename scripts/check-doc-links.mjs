#!/usr/bin/env node
import { readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const root = process.cwd();
const markdownFiles = [
  join(root, "README.md"),
  ...(await collectMarkdown(join(root, "docs"))),
  ...(await collectPackageReadmes(join(root, "packages")))
].sort();
const issues = [];

for (const filePath of markdownFiles) {
  const content = await readText(filePath);
  const linkPattern = /!?\[[^\]]*]\(([^)]+)\)/g;
  let match;

  while ((match = linkPattern.exec(content))) {
    const target = normalizeMarkdownTarget(match[1]);

    if (!target || shouldSkipTarget(target)) {
      continue;
    }

    const targetPath = resolve(dirname(filePath), target.split("#")[0].split("?")[0]);

    if (!(await exists(targetPath))) {
      issues.push(`${relativePath(filePath)} links to missing ${target}`);
    }
  }
}

console.log(
  JSON.stringify(
    {
      ok: issues.length === 0,
      checkedFiles: markdownFiles.length,
      issues
    },
    null,
    2
  )
);

if (issues.length > 0) {
  process.exit(1);
}

async function collectMarkdown(directory) {
  const files = [];

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectMarkdown(path)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(path);
    }
  }

  return files;
}

async function collectPackageReadmes(directory) {
  const files = [];

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const readme = join(directory, entry.name, "README.md");

    if (await exists(readme)) {
      files.push(readme);
    }
  }

  return files;
}

async function readText(path) {
  return (await import("node:fs/promises")).readFile(path, "utf8");
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function normalizeMarkdownTarget(raw) {
  const trimmed = raw.trim();
  const unwrapped =
    trimmed.startsWith("<") && trimmed.includes(">")
      ? trimmed.slice(1, trimmed.indexOf(">"))
      : trimmed;

  return unwrapped.split(/\s+/)[0];
}

function shouldSkipTarget(target) {
  return (
    target.startsWith("#") ||
    /^[a-z][a-z0-9+.-]*:/i.test(target) ||
    target.startsWith("data:") ||
    target.length === 0
  );
}

function relativePath(path) {
  return path.slice(root.length + 1);
}
