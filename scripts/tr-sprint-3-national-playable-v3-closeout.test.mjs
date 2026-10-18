import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("sprint 3 playable-v3 closeout script is present", async () => {
  const script = path.join(ROOT, "scripts/generate-tr-sprint-3-national-playable-v3-closeout.mjs");
  assert.ok(existsSync(script));
  const source = await readFile(script, "utf8");
  assert.match(source, /territorykit-tr-sprint-3-playable-v3-closeout@1/);
});
