import { existsSync } from "node:fs";
import { resolve } from "node:path";

export type TurkeyNationalBlockerRegressionInputPick = "env" | "local" | "fixture" | "missing";

export type TurkeyNationalBlockerRegressionInputs =
  | {
      status: "ready";
      barrierRoot: string;
      datasetPath: string;
      barrierPick: TurkeyNationalBlockerRegressionInputPick;
      datasetPick: TurkeyNationalBlockerRegressionInputPick;
    }
  | {
      status: "NOT_RUN_MISSING_REAL_ARTIFACT";
      barrierRoot: string;
      datasetPath: string;
      barrierPick: TurkeyNationalBlockerRegressionInputPick;
      datasetPick: TurkeyNationalBlockerRegressionInputPick;
    };

function pickRegressionPath(
  envValue: string | undefined,
  localPath: string,
  fixturePath: string
): { path: string; pick: TurkeyNationalBlockerRegressionInputPick } {
  if (envValue) {
    const path = resolve(envValue);
    return { path, pick: existsSync(path) ? "env" : "missing" };
  }
  if (existsSync(localPath)) {
    return { path: localPath, pick: "local" };
  }
  if (existsSync(fixturePath)) {
    return { path: fixturePath, pick: "fixture" };
  }
  return { path: fixturePath, pick: "missing" };
}

export function resolveTurkeyNationalBlockerRegressionInputs(options: {
  repoRoot: string;
  fixtureRoot: string;
}): TurkeyNationalBlockerRegressionInputs {
  const localBarrierRoot = resolve(options.repoRoot, ".territory/sprint-6/calibration/barriers");
  const localDatasetPath = resolve(
    options.repoRoot,
    "datasets/generated/countries/TR/dataset.json"
  );
  const fixtureBarrierRoot = resolve(options.fixtureRoot, "barriers");
  const fixtureDatasetPath = resolve(options.fixtureRoot, "adm2-dataset.json");

  const barrier = pickRegressionPath(
    process.env.TERRITORY_TR_BLOCKER_BARRIER_ROOT,
    localBarrierRoot,
    fixtureBarrierRoot
  );
  const dataset = pickRegressionPath(
    process.env.TERRITORY_TR_BLOCKER_DATASET_PATH,
    localDatasetPath,
    fixtureDatasetPath
  );

  const base = {
    barrierRoot: barrier.path,
    datasetPath: dataset.path,
    barrierPick: barrier.pick,
    datasetPick: dataset.pick
  };

  if (barrier.pick === "missing" || dataset.pick === "missing") {
    return { status: "NOT_RUN_MISSING_REAL_ARTIFACT", ...base };
  }

  return { status: "ready", ...base };
}
