import fs from "node:fs/promises";
import { computeTerritoryAreaM2 } from "../packages/dataset/dist/index.mjs";
import {
  buildTurkeyNetworkFirstSmartFallbackWithAdjacency,
  createTurkeyOsmSmartFallbackGeneratedOptions,
  readTurkeyOsmAdm2BarrierArtifact
} from "../packages/generators/dist/turkey-adm3.mjs";

const name = process.argv[2];
const output = process.argv[3];
if (!name || !output)
  throw Error("Usage: node scripts/sprint-6-network-debug.mjs <district> <output.json>");
const source = JSON.parse(
  await fs.readFile("datasets/generated/countries/TR/dataset.json", "utf8")
);
const district = source.zones.find((zone) => zone.level === 2 && zone.name === name);
if (!district) throw Error(`ADM2 district not found: ${name}`);
const artifact = await readTurkeyOsmAdm2BarrierArtifact(
  ".territory/sprint-6/calibration/barriers",
  district.id
);
const generated = createTurkeyOsmSmartFallbackGeneratedOptions(artifact, {
  smartFallbackOptions: {
    maxTerritories: computeTerritoryAreaM2(district.geometry) > 100_000_000 ? 32 : 128
  }
});
const smart = generated.smartFallback;
const result = await buildTurkeyNetworkFirstSmartFallbackWithAdjacency({
  parent: district,
  provinceCode: "34",
  districtCode: district.id.slice(8),
  profile: smart?.profile ?? "auto",
  roads: smart.roads,
  railways: smart.railways,
  water: smart.water,
  landuse: smart.landuse,
  parks: smart.parks,
  localitySeeds: smart.localitySeeds,
  options: smart.options
});
const invalidIds = new Set(result.quality.geometryValidationErrors.map((issue) => issue.zoneId));
await fs.writeFile(
  output,
  JSON.stringify(
    {
      district: name,
      status: result.status,
      configuration: result.configuration,
      quality: result.quality,
      zones: result.zones.map((zone) => ({ id: zone.id, geometry: zone.geometry })),
      invalidZones: result.zones
        .filter((zone) => invalidIds.has(zone.id))
        .map((zone) => ({ id: zone.id, geometry: zone.geometry }))
    },
    null,
    2
  ) + "\n"
);
console.log(`${name}: ${result.status}, ${result.zones.length} zones, ${invalidIds.size} invalid`);
