#!/usr/bin/env node
import { buildTurkeyGaziantepAdm3Pilot } from "../packages/generators/dist/index.mjs";

const [command = "build", ...args] = process.argv.slice(2);
const flags = parseFlags(args);

if (command === "--help" || command === "-h" || command === "help") {
  printHelp();
  process.exitCode = 0;
} else if (command === "build" || command === "validate" || command === "update") {
  try {
    const result = await buildTurkeyGaziantepAdm3Pilot({
      ...(getFlag(flags, "source") ? { sourcePath: getFlag(flags, "source") } : {}),
      ...(getFlag(flags, "output") ? { outputPath: getFlag(flags, "output") } : {}),
      ...(getFlag(flags, "build-date") ? { buildDate: getFlag(flags, "build-date") } : {}),
      ...(getFlag(flags, "repair-python")
        ? { repairPythonPath: getFlag(flags, "repair-python") }
        : {}),
      ...(flags.has("fetch") ? { fetchSource: true } : {}),
      ...(flags.has("dry-run") || command === "validate" ? { dryRun: true } : {}),
      ...(flags.has("approve-unexpected-source") ? { approveUnexpectedSource: true } : {})
    });

    printJson({
      ok: result.ok,
      command: `data:tr:adm3:${command}`,
      data: {
        outputPath: result.outputPath,
        dryRun: result.dryRun,
        sourceSha256: result.sourceSha256,
        sourceSizeBytes: result.sourceSizeBytes,
        featureCount: result.featureCount,
        coveredParentIds: result.coveredParentIds,
        qualitySummary: result.qualityReport.summary,
        adjacencyStatistics: result.adjacencyStatistics,
        artifactSizes: result.artifactSizes
      },
      issues: result.issues
    });
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    printJson({
      ok: false,
      command: `data:tr:adm3:${command}`,
      issues: [
        {
          code: "TR_ADM3_PILOT_FAILED",
          severity: "error",
          message: error instanceof Error ? error.message : String(error)
        }
      ]
    });
    process.exitCode = 1;
  }
} else {
  printJson({
    ok: false,
    command: `data:tr:adm3:${command}`,
    issues: [
      {
        code: "CLI_USAGE",
        severity: "error",
        message: `Unknown Turkey ADM3 pilot command '${command}'.`
      }
    ]
  });
  process.exitCode = 2;
}

function parseFlags(input) {
  const flags = new Map();

  for (let index = 0; index < input.length; index += 1) {
    const value = input[index];

    if (!value?.startsWith("--")) {
      continue;
    }

    const key = value.slice(2);
    const next = input[index + 1];

    if (next && !next.startsWith("--")) {
      flags.set(key, next);
      index += 1;
    } else {
      flags.set(key, true);
    }
  }

  return flags;
}

function getFlag(flags, key) {
  const value = flags.get(key);
  return typeof value === "string" ? value : undefined;
}

function printJson(input) {
  console.log(JSON.stringify(input, null, 2));
}

function printHelp() {
  console.log(`data-tr-adm3 <build|validate|update>

Options:
  --source <path>                    Read source KML from an explicit path
  --output <dir>                     Write deterministic pilot artifacts to a directory
  --fetch                            Download the locked source into .territory/cache first
  --dry-run                          Build and compare without writing output
  --approve-unexpected-source         Allow a checksum change for an intentional update review
  --repair-python <path>              Use an explicit Python with Shapely for geometry repair
  --build-date <iso-date>            Override deterministic generatedAt/buildDate metadata`);
}
