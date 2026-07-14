import {
  createTerritoryAdjacencyIndex,
  loadTerritoryDataset,
  validateTerritoryAdjacencyArtifact
} from "@territory-kit/dataset";
import type {
  TerritoryAdminLevel,
  TerritoryAdjacencyArtifact,
  TerritoryAdjacencyIndex,
  TerritoryDataset
} from "@territory-kit/dataset";

export interface TerritoryCountryDatasetDescriptor {
  datasetId: string;
  countryCodeAlpha2: string;
  countryCodeAlpha3: string;
  packageName: string;
  schemaVersion: string;
  supportedLevels: readonly TerritoryAdminLevel[];
  defaultLevels: readonly TerritoryAdminLevel[];
  manifestPath: string;
  requiresResolver: boolean;
}

export interface TerritoryDatasetArtifactResolver {
  resolveArtifact(path: string): Promise<unknown>;
}

export interface TerritoryCountryDatasetLoadOptions {
  levels?: readonly TerritoryAdminLevel[];
  detail?: string;
  resolveArtifact?: TerritoryDatasetArtifactResolver | ((path: string) => Promise<unknown>);
  verifyChecksums?: boolean;
  loadAdjacency?: boolean;
}

export interface TerritoryCountryDatasetHandle {
  descriptor: TerritoryCountryDatasetDescriptor;
  manifest: unknown;
  levels: Partial<Record<TerritoryAdminLevel, TerritoryDataset>>;
  adjacency: Partial<Record<TerritoryAdminLevel, TerritoryAdjacencyArtifact>>;
  adjacencyIndexes: Partial<Record<TerritoryAdminLevel, TerritoryAdjacencyIndex>>;
}

export function createTerritoryCountryDatasetDescriptor(
  descriptor: TerritoryCountryDatasetDescriptor
): TerritoryCountryDatasetDescriptor {
  return {
    ...descriptor,
    countryCodeAlpha2: descriptor.countryCodeAlpha2.toUpperCase(),
    countryCodeAlpha3: descriptor.countryCodeAlpha3.toUpperCase(),
    supportedLevels: [...descriptor.supportedLevels],
    defaultLevels: [...descriptor.defaultLevels]
  };
}

export async function loadTerritoryCountryDataset(
  descriptor: TerritoryCountryDatasetDescriptor,
  options: TerritoryCountryDatasetLoadOptions = {}
): Promise<TerritoryCountryDatasetHandle> {
  const resolver = normalizeResolver(options.resolveArtifact);

  if (!resolver) {
    throw new Error(
      `${descriptor.packageName} does not embed geometry artifacts. Pass resolveArtifact to load datasets.`
    );
  }

  const levels = normalizeRequestedLevels(descriptor, options.levels);
  const checksums = options.verifyChecksums ? await readChecksums(resolver) : undefined;
  const manifest = await readJsonArtifact(resolver, descriptor.manifestPath, checksums);
  const loadedLevels: Partial<Record<TerritoryAdminLevel, TerritoryDataset>> = {};
  const adjacency: Partial<Record<TerritoryAdminLevel, TerritoryAdjacencyArtifact>> = {};
  const adjacencyIndexes: Partial<Record<TerritoryAdminLevel, TerritoryAdjacencyIndex>> = {};

  for (const level of levels) {
    const dataset = loadTerritoryDataset(
      await readJsonArtifact(resolver, `levels/${level}/dataset.json`, checksums)
    );
    loadedLevels[level] = dataset;

    if (options.loadAdjacency && level !== "ADM0") {
      const artifact = (await readJsonArtifact(
        resolver,
        `adjacency/${level}/adjacency.json`,
        checksums
      )) as TerritoryAdjacencyArtifact;
      const validation = validateTerritoryAdjacencyArtifact(dataset, artifact);

      if (!validation.ok) {
        throw new Error(`Adjacency artifact for ${level} failed validation.`);
      }

      adjacency[level] = artifact;
      adjacencyIndexes[level] = createTerritoryAdjacencyIndex(artifact);
    }
  }

  return {
    descriptor: createTerritoryCountryDatasetDescriptor(descriptor),
    manifest,
    levels: loadedLevels,
    adjacency,
    adjacencyIndexes
  };
}

function normalizeResolver(
  resolver: TerritoryCountryDatasetLoadOptions["resolveArtifact"]
): TerritoryDatasetArtifactResolver | undefined {
  if (!resolver) {
    return undefined;
  }

  return typeof resolver === "function" ? { resolveArtifact: resolver } : resolver;
}

function normalizeRequestedLevels(
  descriptor: TerritoryCountryDatasetDescriptor,
  requestedLevels: readonly TerritoryAdminLevel[] | undefined
): TerritoryAdminLevel[] {
  const supported = new Set(descriptor.supportedLevels);
  const levels = [...(requestedLevels ?? descriptor.defaultLevels)];

  for (const level of levels) {
    if (!supported.has(level)) {
      throw new Error(`${descriptor.datasetId} does not support ${level}.`);
    }
  }

  return levels.sort(compareAdminLevels);
}

async function readChecksums(
  resolver: TerritoryDatasetArtifactResolver
): Promise<Record<string, string>> {
  const input = await readJsonArtifact(resolver, "checksums.json");

  if (
    input &&
    typeof input === "object" &&
    "files" in input &&
    input.files &&
    typeof input.files === "object" &&
    !Array.isArray(input.files)
  ) {
    return input.files as Record<string, string>;
  }

  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, string>;
  }

  throw new Error("Invalid checksums artifact.");
}

async function readJsonArtifact(
  resolver: TerritoryDatasetArtifactResolver,
  path: string,
  checksums?: Readonly<Record<string, string>>
): Promise<unknown> {
  const raw = await resolver.resolveArtifact(path);
  const text = normalizeArtifactText(raw);
  const expectedChecksum = checksums?.[path];

  if (expectedChecksum) {
    const actualChecksum = await sha256Hex(text);

    if (actualChecksum !== expectedChecksum) {
      throw new Error(`Checksum mismatch for ${path}.`);
    }
  }

  return JSON.parse(text) as unknown;
}

function normalizeArtifactText(input: unknown): string {
  if (typeof input === "string") {
    return input;
  }

  if (input instanceof Uint8Array) {
    return new TextDecoder().decode(input);
  }

  return JSON.stringify(input);
}

async function sha256Hex(input: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;

  if (!subtle) {
    throw new Error("Checksum verification requires Web Crypto.");
  }

  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function compareAdminLevels(left: TerritoryAdminLevel, right: TerritoryAdminLevel): number {
  return Number(left.slice(3)) - Number(right.slice(3));
}
