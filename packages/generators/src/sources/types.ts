import type {
  TerritoryAdminLevel,
  TerritoryDataset,
  TerritoryGlobalDatasetManifest
} from "@territory-kit/dataset";

export type TerritorySourceStage =
  | "resolve"
  | "fetch"
  | "verify"
  | "extract"
  | "parse"
  | "normalize"
  | "transform"
  | "validate"
  | "enrich"
  | "serialize"
  | "complete";

export type TerritorySourceSeverity = "info" | "warning" | "error";

export interface TerritorySourceCapabilities {
  localFile: boolean;
  remoteFetch: boolean;
  cache: boolean;
  attributionRequired: boolean;
}

export interface TerritorySourceOptionDescription {
  name: string;
  required: boolean;
  description: string;
}

export interface TerritorySourceDescription {
  id: string;
  displayName: string;
  supportedAdminLevels: readonly TerritoryAdminLevel[];
  supportedTransports: readonly string[];
  inputFormats: readonly string[];
  defaultSourceUrl?: string;
  defaultLicense?: string;
  attributionRequired: boolean;
  sourceVersion?: string;
  options: readonly TerritorySourceOptionDescription[];
  exampleCommand: string;
}

export interface TerritorySourceRequest {
  input?: string;
  url?: string;
  expectedSha256?: string;
  version?: string;
  refresh?: boolean;
}

export interface TerritorySourceArtifact {
  provider: string;
  localPath: string;
  originalUrl?: string;
  sha256: string;
  sizeBytes: number;
  etag?: string;
  lastModified?: string;
  sourceVersion?: string;
  fetchedAt?: string;
  cacheHit: boolean;
}

export interface TerritorySourceIssue {
  stage: TerritorySourceStage;
  severity: TerritorySourceSeverity;
  code: string;
  message: string;
  provider?: string;
  featureId?: string;
  sourcePath?: string;
  cause?: string;
  repairSuggestion?: string;
  details?: Record<string, unknown>;
}

export interface DatasetAttribution {
  provider: string;
  text: string;
  license?: string;
  sourceUrl?: string;
}

export interface TerritorySourceStatistics {
  inputFeatureCount: number;
  acceptedFeatureCount: number;
  skippedFeatureCount: number;
  warningCount: number;
  errorCount: number;
  [metric: string]: string | number | boolean;
}

export interface TerritorySourceTransformResult {
  dataset: TerritoryDataset;
  manifestMetadata: Partial<TerritoryGlobalDatasetManifest>;
  attribution: DatasetAttribution;
  issues: TerritorySourceIssue[];
  statistics: TerritorySourceStatistics;
  datasets?: Record<string, TerritoryDataset>;
  files?: Map<string, string>;
  manifest?: TerritoryGlobalDatasetManifest;
  checksums?: {
    algorithm: "sha256";
    files: Record<string, string>;
  };
  buildReport?: unknown;
}

export interface TerritorySourceVerificationResult {
  ok: boolean;
  issues: TerritorySourceIssue[];
}

export interface TerritorySourcePipelineEvent {
  stage: TerritorySourceStage;
  status: "started" | "completed" | "failed";
  provider: string;
  durationMs?: number;
  details?: Record<string, unknown>;
}

export interface TerritorySourceCacheOptions {
  enabled: boolean;
  directory?: string;
}

export interface TerritorySourceContext {
  cwd: string;
  request: TerritorySourceRequest;
  signal?: AbortSignal;
  maxSourceSizeBytes: number;
  cache: TerritorySourceCacheOptions;
  now(): string;
  resolveArtifact(
    provider: string,
    request: TerritorySourceRequest
  ): Promise<TerritorySourceArtifact>;
}

export interface TerritorySourceAdapter<TOptions = unknown, TParsed = unknown> {
  readonly id: string;
  readonly displayName: string;
  readonly supportedAdminLevels: readonly TerritoryAdminLevel[];
  readonly capabilities: TerritorySourceCapabilities;
  describe(): TerritorySourceDescription;
  validateOptions?(options: TOptions): TerritorySourceIssue[];
  fetch(
    request: TerritorySourceRequest,
    context: TerritorySourceContext
  ): Promise<TerritorySourceArtifact>;
  verify(
    artifact: TerritorySourceArtifact,
    context: TerritorySourceContext
  ): Promise<TerritorySourceVerificationResult>;
  parse(
    artifact: TerritorySourceArtifact,
    options: TOptions,
    context: TerritorySourceContext
  ): Promise<TParsed>;
  normalize?(parsed: TParsed, options: TOptions, context: TerritorySourceContext): Promise<TParsed>;
  transform(
    parsed: TParsed,
    options: TOptions,
    context: TerritorySourceContext
  ): Promise<TerritorySourceTransformResult>;
}

export interface TerritorySourcePipelineOptions<TOptions = unknown> {
  adapter: string | TerritorySourceAdapter<TOptions>;
  request: TerritorySourceRequest;
  options: TOptions;
  registry?: TerritorySourceRegistryLike;
  cwd?: string;
  outputPath?: string;
  force?: boolean;
  strict?: boolean;
  cache?: Partial<TerritorySourceCacheOptions>;
  noCache?: boolean;
  maxSourceSizeBytes?: number;
  now?: () => string;
  signal?: AbortSignal;
  onEvent?: (event: TerritorySourcePipelineEvent) => void;
}

export interface TerritorySourcePipelineOutput {
  outputPath: string;
  files: Record<string, string>;
}

export interface TerritorySourcePipelineResult {
  ok: boolean;
  provider: string;
  issues: TerritorySourceIssue[];
  events: TerritorySourcePipelineEvent[];
  artifact?: TerritorySourceArtifact;
  transform?: TerritorySourceTransformResult;
  output?: TerritorySourcePipelineOutput;
}

export interface TerritorySourceRegistryLike {
  get(id: string): TerritorySourceAdapter;
  list(): TerritorySourceAdapter[];
  has(id: string): boolean;
}
