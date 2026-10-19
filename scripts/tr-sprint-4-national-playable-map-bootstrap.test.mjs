import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("sprint 4 playable map bootstrap script is present", async () => {
  const script = path.join(ROOT, "scripts/tr-sprint-4-national-playable-map-bootstrap.mjs");
  const source = await readFile(script, "utf8");
  assert.match(source, /territorykit-tr-sprint-4-national-playable-map@1/);
  assert.match(source, /territory_adm3/);
  assert.match(source, /includeQueryFile: false/);
  assert.match(source, /normalizeRegistryArtifactUrl/);
  assert.match(source, /localPlayableRegistryBaseUrl/);
});
