import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { TerritoryDataset } from "@territory-kit/dataset";

export function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

export function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

export function serializeJsonStable(input: unknown): string {
  return `${JSON.stringify(sortJson(input), null, 2)}\n`;
}

export function createDatasetGeometryHash(dataset: Pick<TerritoryDataset, "zones">): string {
  const stableGeometryPayload = dataset.zones
    .map((zone) => ({
      geometry: zone.geometry,
      id: zone.id,
      level: zone.level,
      parentId: zone.parentId ?? null
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

  return sha256Hex(JSON.stringify(stableGeometryPayload));
}

export function readPropertyPath(input: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".").filter(Boolean);
  let current: unknown = input;

  for (const part of parts) {
    if (!isRecord(current)) {
      return undefined;
    }

    current = current[part];
  }

  return current;
}

export function readStringPropertyPath(
  input: Record<string, unknown>,
  path: string
): string | undefined {
  const value = readPropertyPath(input, path);

  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return undefined;
}

export function normalizeSourceAdapterId(input: string): string {
  const normalized = input.trim().toLowerCase();

  if (!/^[a-z0-9][a-z0-9-]*$/.test(normalized)) {
    throw new Error("Source adapter id must contain lowercase letters, numbers, and hyphens.");
  }

  return normalized;
}

export function sortJson(input: unknown): unknown {
  if (Array.isArray(input)) {
    return input.map((value) => sortJson(value));
  }

  if (isRecord(input)) {
    return Object.fromEntries(
      Object.entries(input)
        .filter(([, value]) => value !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => [key, sortJson(value)])
    );
  }

  return input;
}

export async function writeFilesAtomically(
  outputPath: string,
  files: ReadonlyMap<string, string>,
  options: { force?: boolean }
): Promise<void> {
  if (await pathExists(outputPath)) {
    if (!options.force) {
      throw new Error(`Output path '${outputPath}' already exists.`);
    }
  }

  const tempParent = dirname(outputPath);
  await mkdir(tempParent, { recursive: true });
  const tempPath = await mkdtemp(join(tempParent, `.${basename(outputPath)}-tmp-`));

  try {
    for (const [relativePath, content] of [...files.entries()].sort(([left], [right]) =>
      left.localeCompare(right)
    )) {
      const targetPath = join(tempPath, relativePath);
      await mkdir(dirname(targetPath), { recursive: true });
      await writeFile(targetPath, content, "utf8");
    }

    if (await pathExists(outputPath)) {
      await rm(outputPath, { recursive: true, force: true });
    }

    await rename(tempPath, outputPath);
  } catch (error) {
    await rm(tempPath, { recursive: true, force: true });
    throw error;
  }
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
