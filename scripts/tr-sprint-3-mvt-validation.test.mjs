import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import test from "node:test";
import {
  TURKEY_V2_MVT_CONSUMER_SOURCE_LAYER,
  aggregateMvtReadiness,
  classifyMvtDistrictSample,
  findDistrictFeatureInLayer,
  resolveCandidateRoot
} from "./lib/tr-mvt-delivery-contract.mjs";

const requireFromGenerators = createRequire(
  resolve(new URL(".", import.meta.url).pathname, "../packages/generators/package.json")
);
const { VectorTile } = requireFromGenerators("@mapbox/vector-tile");
const { PbfReader } = requireFromGenerators("pbf");
const { fromGeojsonVt } = requireFromGenerators("@maplibre/vt-pbf");
const geojsonVtModuleUrl = new URL(
  "../packages/generators/node_modules/@maplibre/geojson-vt/dist/geojson-vt.mjs",
  import.meta.url
).href;
const { GeoJSONVT } = await import(geojsonVtModuleUrl);

const ROOT = resolve(new URL("..", import.meta.url).pathname);

function decodeTile(bytes) {
  return new VectorTile(new PbfReader(bytes));
}

function buildFixtureTile(features, layerName = "territory_adm3") {
  const collection = { type: "FeatureCollection", features };
  const index = new GeoJSONVT(collection, { maxZoom: 0, indexMaxZoom: 0, indexMaxPoints: 0 });
  const tile = index.getTile(0, 0, 0);
  if (!tile) throw new Error("fixture tile empty");
  const layers = { [layerName]: tile };
  return fromGeojsonVt(layers);
}

test("ACTUAL_LAYER_MATCH requires exact consumer source-layer", () => {
  const bytes = buildFixtureTile([
    {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [0, 0.01],
            [0.01, 0.01],
            [0.01, 0],
            [0, 0]
          ]
        ]
      },
      properties: {
        territoryId: "zone-a",
        parentAdm2Id: "tr:adm2:expected",
        adminLevel: "ADM3",
        sourceClass: "official"
      }
    }
  ]);
  const ok = classifyMvtDistrictSample({
    bytes,
    expectedAdm2Id: "tr:adm2:expected",
    consumerSourceLayer: TURKEY_V2_MVT_CONSUMER_SOURCE_LAYER,
    renderArtifactLayerId: "territory-adm3",
    decodeTile
  });
  assert.equal(ok.classification, "ACTUAL_LAYER_MATCH");
  assert.equal(ok.encodedProtobufLayer, "territory_adm3");
  assert.equal(ok.districtClassification, "DISTRICT_VERIFIED");

  const wrongLayer = classifyMvtDistrictSample({
    bytes,
    expectedAdm2Id: "tr:adm2:expected",
    consumerSourceLayer: "territory-adm3",
    decodeTile
  });
  assert.equal(wrongLayer.classification, "MISSING_LAYER");
});

test("MANIFEST_LAYER_MISMATCH when declared sourceLayer disagrees with bytes", () => {
  const bytes = buildFixtureTile([
    {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [0, 0.01],
            [0.01, 0.01],
            [0.01, 0],
            [0, 0]
          ]
        ]
      },
      properties: { territoryId: "z", parentAdm2Id: "tr:adm2:a", adminLevel: "ADM3" }
    }
  ]);
  const verdict = classifyMvtDistrictSample({
    bytes,
    expectedAdm2Id: "tr:adm2:a",
    consumerSourceLayer: TURKEY_V2_MVT_CONSUMER_SOURCE_LAYER,
    deliveryManifestSourceLayer: "territory-adm3",
    decodeTile
  });
  assert.equal(verdict.classification, "MANIFEST_LAYER_MISMATCH");
  const mismatchReadiness = aggregateMvtReadiness([verdict]);
  assert.equal(mismatchReadiness.pass, false);
  assert.equal(mismatchReadiness.fullMvtDeliveryReady, false);
  assert.equal(mismatchReadiness.sourceLayerGate, "FAIL");
});

function fixtureVerdict(bytes, expectedAdm2Id, extra = {}) {
  return classifyMvtDistrictSample({
    bytes,
    expectedAdm2Id,
    consumerSourceLayer: TURKEY_V2_MVT_CONSUMER_SOURCE_LAYER,
    decodeTile,
    ...extra
  });
}

function minimalPolygonFeature(properties) {
  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [0, 0.01],
          [0.01, 0.01],
          [0.01, 0],
          [0, 0]
        ]
      ]
    },
    properties
  };
}

test("sourceLayer PASS when district parentAdm2Id metadata absent on all samples", () => {
  const bytes = buildFixtureTile([
    minimalPolygonFeature({ territoryId: "z", adminLevel: "ADM3", sourceClass: "official" })
  ]);
  const verdict = fixtureVerdict(bytes, "tr:adm2:expected");
  assert.equal(verdict.districtClassification, "FEATURE_METADATA_ABSENT");
  const readiness = aggregateMvtReadiness([verdict]);
  assert.equal(readiness.sourceLayerGate, "PASS");
  assert.equal(readiness.sourceLayerReady, true);
  assert.equal(readiness.districtRepresentativeGate, "FAIL");
  assert.equal(readiness.fullMvtDeliveryReady, false);
  assert.equal(readiness.pass, false);
});

test("missing tile (INSUFFICIENT_EVIDENCE) cannot yield full delivery PASS", () => {
  const readiness = aggregateMvtReadiness([
    {
      classification: "INSUFFICIENT_EVIDENCE",
      districtClassification: "INSUFFICIENT_EVIDENCE"
    }
  ]);
  assert.equal(readiness.sourceLayerGate, "INSUFFICIENT_EVIDENCE");
  assert.equal(readiness.sourceLayerReady, false);
  assert.equal(readiness.fullMvtDeliveryReady, false);
  assert.equal(readiness.pass, false);
  assert.equal(readiness.gate, "FAIL");
});

test("valid source-layer and district evidence yields full MVT delivery PASS", () => {
  const bytes = buildFixtureTile([
    minimalPolygonFeature({
      territoryId: "z",
      parentAdm2Id: "tr:adm2:expected",
      adminLevel: "ADM3",
      sourceClass: "official"
    })
  ]);
  const verdict = fixtureVerdict(bytes, "tr:adm2:expected");
  const readiness = aggregateMvtReadiness([verdict]);
  assert.equal(readiness.sourceLayerGate, "PASS");
  assert.equal(readiness.districtRepresentativeGate, "PASS");
  assert.equal(readiness.fullMvtDeliveryReady, true);
  assert.equal(readiness.pass, true);
  assert.equal(readiness.gate, "PASS");
});

test("encoded layer mismatch fails source layer and full delivery", () => {
  const bytes = buildFixtureTile(
    [minimalPolygonFeature({ territoryId: "z", parentAdm2Id: "tr:adm2:a", adminLevel: "ADM3" })],
    "wrong-layer-name"
  );
  const verdict = classifyMvtDistrictSample({
    bytes,
    expectedAdm2Id: "tr:adm2:a",
    consumerSourceLayer: TURKEY_V2_MVT_CONSUMER_SOURCE_LAYER,
    decodeTile
  });
  assert.equal(verdict.classification, "MISSING_LAYER");
  const readiness = aggregateMvtReadiness([verdict]);
  assert.equal(readiness.sourceLayerGate, "FAIL");
  assert.equal(readiness.fullMvtDeliveryReady, false);
});

test("all mandatory checks passing across multiple representative samples", () => {
  const polygon = minimalPolygonFeature({
    territoryId: "z",
    parentAdm2Id: "tr:adm2:a",
    adminLevel: "ADM3"
  });
  const bytesA = buildFixtureTile([polygon]);
  const bytesB = buildFixtureTile([
    {
      ...polygon,
      properties: { ...polygon.properties, parentAdm2Id: "tr:adm2:b", territoryId: "z2" }
    }
  ]);
  const samples = [fixtureVerdict(bytesA, "tr:adm2:a"), fixtureVerdict(bytesB, "tr:adm2:b")];
  const readiness = aggregateMvtReadiness(samples);
  assert.equal(readiness.sourceLayerGate, "PASS");
  assert.equal(readiness.districtRepresentativeGate, "PASS");
  assert.equal(readiness.fullMvtDeliveryReady, true);
});

test("multi-district tile selects matching parentAdm2Id, not feature(0)", () => {
  const polygon = {
    type: "Polygon",
    coordinates: [
      [
        [0, 0],
        [0, 0.01],
        [0.01, 0.01],
        [0.01, 0],
        [0, 0]
      ]
    ]
  };
  const bytes = buildFixtureTile([
    {
      type: "Feature",
      geometry: polygon,
      properties: {
        territoryId: "zone-neighbor",
        parentAdm2Id: "tr:adm2:neighbor",
        adminLevel: "ADM3",
        sourceClass: "official"
      }
    },
    {
      type: "Feature",
      geometry: polygon,
      properties: {
        territoryId: "zone-target",
        parentAdm2Id: "tr:adm2:target",
        adminLevel: "ADM3",
        sourceClass: "generated"
      }
    }
  ]);
  const tile = decodeTile(bytes);
  const layer = tile.layers.territory_adm3;
  const match = findDistrictFeatureInLayer(layer, "tr:adm2:target");
  assert.ok(match);
  assert.equal(match.index, 1);
  const verdict = classifyMvtDistrictSample({
    bytes,
    expectedAdm2Id: "tr:adm2:target",
    consumerSourceLayer: TURKEY_V2_MVT_CONSUMER_SOURCE_LAYER,
    decodeTile
  });
  assert.equal(verdict.districtClassification, "DISTRICT_VERIFIED");
  assert.ok(match.index > 0, "expected neighbor feature to sort before target in tile");
  assert.equal(verdict.districtFeatureIndex, match.index);
});

test("custom TERRITORY_TR_RC7_CANDIDATE cannot silently validate default", async () => {
  const missing = join("/tmp", `tk-rc7-missing-${Date.now()}`);
  const { candidateRoot, requestedExplicit } = resolveCandidateRoot(
    { TERRITORY_TR_RC7_CANDIDATE: missing },
    join(ROOT, ".territory/sprint-6/final/candidate"),
    resolve
  );
  assert.equal(requestedExplicit, true);
  assert.equal(candidateRoot, resolve(missing));
  execSync("node scripts/generate-tr-sprint-3-national-rc-reports.mjs", {
    cwd: ROOT,
    stdio: "pipe",
    env: { ...process.env, TERRITORY_TR_RC7_CANDIDATE: missing }
  });
  const inventory = JSON.parse(
    await readFile(
      join(ROOT, "reports/tr-adm3/sprint-3-national-rc/artifact-inventory.json"),
      "utf8"
    )
  );
  assert.equal(inventory.classification, "BLOCKED_BY_MISSING_ARTIFACT");
  assert.ok(inventory.candidateRootRequested?.includes("tk-rc7-missing"));
});
