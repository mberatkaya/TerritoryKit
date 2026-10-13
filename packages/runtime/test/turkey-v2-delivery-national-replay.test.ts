import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolveTurkeyV2Boundaries,
  validateTurkeyV2DeliveryManifest,
  type TurkeyV2DeliveryIndex
} from "../src/turkey-v2-delivery.js";

const ROOT = resolve(import.meta.dirname, "../../..");
const CANDIDATE =
  process.env.TERRITORY_TR_RC7_CANDIDATE ?? join(ROOT, ".territory/sprint-6/final/candidate");
const MANIFEST_REL = "delivery-manifest-hardened.json";
const FATIH_ADM2 = "tr:adm2:54988432b39641834885080";

const candidateReady = existsSync(join(CANDIDATE, MANIFEST_REL));

describe.skipIf(!candidateReady)("Turkey V2 national consumer replay (local rc.7 bytes)", () => {
  it("resolves Fatih with checksum-verified shard and honors allowEstimated", async () => {
    const manifest = JSON.parse(
      await readFile(join(CANDIDATE, MANIFEST_REL), "utf8")
    ) as TurkeyV2DeliveryIndex;
    await validateTurkeyV2DeliveryManifest(manifest, manifest.contentHash);
    const loadShard = async (path: string) => new Uint8Array(await readFile(join(CANDIDATE, path)));
    const official = await resolveTurkeyV2Boundaries({
      manifest,
      adm2Id: FATIH_ADM2,
      loadShard
    });
    const all = await resolveTurkeyV2Boundaries({
      manifest,
      adm2Id: FATIH_ADM2,
      allowEstimated: true,
      loadShard
    });
    expect(official.datasetVersion).toBe("2.1.0-rc.7");
    expect(all.features.length).toBeGreaterThanOrEqual(official.features.length);
    expect(all.features.length).toBeGreaterThan(0);
    for (const meta of all.metadata) {
      if (meta.boundaryKind === "estimated") {
        expect(meta.administrative).toBe(false);
      }
    }
  });
});
