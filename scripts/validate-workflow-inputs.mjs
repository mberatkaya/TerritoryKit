import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, win32 } from "node:path";

const workspace = realpathSync(process.env.GITHUB_WORKSPACE ?? process.cwd());
const clean = (value, label) => {
  if (/[\x00-\x1f\x7f]/.test(value)) throw new Error(`${label} contains a control character`);
  return value;
};
export function repositoryFile(value, extension) {
  clean(value, "path");
  if (
    !value ||
    isAbsolute(value) ||
    win32.isAbsolute(value) ||
    value.includes("\\") ||
    value.split("/").includes("..")
  )
    throw new Error("Unsafe repository-relative path");
  if (!value.endsWith(extension)) throw new Error(`Expected ${extension} file`);
  const actual = realpathSync(resolve(workspace, value));
  const rel = relative(workspace, actual);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("Path escapes GITHUB_WORKSPACE");
  return actual;
}
export function validateInputs(env = process.env) {
  for (const [name, value] of Object.entries(env))
    if (name.startsWith("INPUT_") && value) clean(value, name);
  if (env.INPUT_LEVELS && !/^ADM[0-3](,ADM[0-3])*$/.test(env.INPUT_LEVELS))
    throw new Error("Invalid levels");
  if (
    env.INPUT_ADM3_PROVINCES &&
    !/^(0?[1-9]|[1-7][0-9]|8[01])(,(0?[1-9]|[1-7][0-9]|8[01]))*$/.test(env.INPUT_ADM3_PROVINCES)
  )
    throw new Error("Invalid province list");
  for (const [name, extension] of [
    ["INPUT_SOURCE_LOCK", ".json"],
    ["INPUT_ADM3_CATALOG", ".json"],
    ["INPUT_BENCHMARK_BASELINE", ".json"]
  ])
    if (env[name]) repositoryFile(env[name], extension);
  if (env.INPUT_DATASET && !/^[a-z0-9][a-z0-9._-]*$/i.test(env.INPUT_DATASET))
    throw new Error("Invalid dataset");
  if (env.INPUT_VERSION && !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-z0-9.-]+)?$/i.test(env.INPUT_VERSION))
    throw new Error("Invalid version");
  if (
    env.INPUT_ARTIFACT_PREFIX &&
    (!/^[a-z0-9._/-]+$/i.test(env.INPUT_ARTIFACT_PREFIX) ||
      env.INPUT_ARTIFACT_PREFIX.split("/").some((p) => p === ".." || !p))
  )
    throw new Error("Invalid artifact prefix");
  if (env.INPUT_BASE_URL) {
    const url = new URL(env.INPUT_BASE_URL);
    if (url.protocol !== "https:" || url.username || url.password || !url.pathname.endsWith("/"))
      throw new Error("Invalid HTTPS base URL");
  }
}
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href)
  validateInputs();
