import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import test from "node:test";

const REPORT_DIR = "reports/tr-adm3/mahalle-identity-layer";

test("Fatih mahalle identity layer generator emits stable schema and determinism", () => {
  execSync(
    "pnpm --filter @territory-kit/dataset build && pnpm --filter @territory-kit/core build && pnpm --filter @territory-kit/generators build && node scripts/tr-mahalle-identity-layer-fatih.mjs",
    { stdio: "pipe", env: { ...process.env } }
  );

  const immutability = JSON.parse(
    fs.readFileSync(`${REPORT_DIR}/fatih-geometry-immutability.json`, "utf8")
  );
  assert.equal(immutability.schemaVersion, "territorykit-tr-mahalle-identity-immutability@1");
  assert.equal(immutability.zoneCount, 30);
  assert.equal(immutability.determinismVerified, true);

  const associations = JSON.parse(
    fs.readFileSync(`${REPORT_DIR}/fatih-zone-associations.json`, "utf8")
  );
  assert.equal(associations.schemaVersion, "territorykit-tr-mahalle-zone-associations@1");
  assert.equal(associations.boundaryMode, "covers");
  assert.ok(associations.associations.length > 0);
});
