import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import {
  runTurkeyGeoBoundariesFullBuilderReplay,
  verifyTurkeyGeoBoundariesFullBuilderReplay
} from "../packages/generators/dist/turkey-adm3.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUTPUT_DIR = path.join(REPO_ROOT, "reports/tr-adm3/provenance/geoboundaries/replay");
const DEFAULT_PARENT_DATASET = path.join(REPO_ROOT, "datasets/generated/countries/TR/dataset.json");
const DEFAULT_SOURCE_LOCK = path.join(
  REPO_ROOT,
  "datasets/generated/countries/TR/sources.lock.json"
);
const GEOBOUNDARIES_CACHE_ROOT = path.join(REPO_ROOT, ".territory/cache/sources/geoboundaries");

export function isGeoBoundariesParentReplayCliEntry(argv = process.argv) {
  const entry = argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

function parseReplayCliArgs(argv) {
  const options = {
    outputDir: DEFAULT_OUTPUT_DIR,
    parentDatasetPath: DEFAULT_PARENT_DATASET,
    sourceLockPath: DEFAULT_SOURCE_LOCK,
    geoBoundariesCacheRoot: GEOBOUNDARIES_CACHE_ROOT,
    replayOutputRoot: undefined,
    skipGeographicEquivalence: false,
    skipSecondDeterminismRun: false,
    strict: true
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--output-dir") {
      options.outputDir = path.resolve(argv[++index] ?? DEFAULT_OUTPUT_DIR);
    } else if (token === "--parent-dataset") {
      options.parentDatasetPath = path.resolve(argv[++index] ?? DEFAULT_PARENT_DATASET);
    } else if (token === "--source-lock") {
      options.sourceLockPath = path.resolve(argv[++index] ?? DEFAULT_SOURCE_LOCK);
    } else if (token === "--geoboundaries-cache") {
      options.geoBoundariesCacheRoot = path.resolve(argv[++index] ?? GEOBOUNDARIES_CACHE_ROOT);
    } else if (token === "--replay-output-root") {
      options.replayOutputRoot = path.resolve(argv[++index] ?? "");
    } else if (token === "--skip-geographic-equivalence") {
      options.skipGeographicEquivalence = true;
    } else if (token === "--skip-determinism") {
      options.skipSecondDeterminismRun = true;
    } else if (token === "--allow-incomplete-evidence") {
      options.strict = false;
    }
  }
  return options;
}

export async function generateGeoBoundariesParentReplayReports(options = {}) {
  const parsed = { ...parseReplayCliArgs([]), ...options };
  const inspectedCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: REPO_ROOT,
    encoding: "utf8"
  }).trim();

  const result = await runTurkeyGeoBoundariesFullBuilderReplay({
    parentDatasetPath: parsed.parentDatasetPath,
    sourceLockPath: parsed.sourceLockPath,
    geoBoundariesCacheRoot: parsed.geoBoundariesCacheRoot,
    outputReportDir: parsed.outputDir,
    ...(parsed.replayOutputRoot ? { replayOutputRoot: parsed.replayOutputRoot } : {}),
    ...(parsed.skipGeographicEquivalence ? { skipGeographicEquivalence: true } : {}),
    ...(parsed.skipSecondDeterminismRun ? { skipSecondDeterminismRun: true } : {}),
    cwd: REPO_ROOT
  });

  const verification = verifyTurkeyGeoBoundariesFullBuilderReplay(result, {
    strict: parsed.strict
  });

  await mkdir(parsed.outputDir, { recursive: true });
  await writeFile(
    path.join(parsed.outputDir, "replay-summary.json"),
    `${JSON.stringify(
      {
        schemaVersion: result.schemaVersion,
        inspectedCommit,
        generatedAt: new Date().toISOString(),
        classification: result.classification,
        pathBTechnicalRecommendation: result.pathBTechnicalRecommendation,
        verification,
        replaySummary: result.replaySummary,
        determinism: result.determinism,
        inputChecksums: result.inputChecksums
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  if (!verification.ok && parsed.strict) {
    const error = new Error(verification.issues.join("; "));
    error.code = "GEOBOUNDARIES_REPLAY_VERIFICATION_FAILED";
    throw error;
  }

  return { result, verification, inspectedCommit };
}

async function main() {
  const parsed = parseReplayCliArgs(process.argv.slice(2));
  const { result } = await generateGeoBoundariesParentReplayReports(parsed);
  process.stdout.write(
    `geoBoundaries full builder replay: ${result.classification} → reports in ${parsed.outputDir}\n`
  );
}

if (isGeoBoundariesParentReplayCliEntry()) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack ?? error}\n`);
    process.exitCode = 1;
  });
}
