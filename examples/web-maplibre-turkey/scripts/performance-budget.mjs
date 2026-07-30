import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const assetDir = join(process.cwd(), "dist", "assets");
const budgets = {
  js: 1_250_000,
  css: 120_000,
  total: 1_400_000
};
const files = readdirSync(assetDir).map((file) => {
  const path = join(assetDir, file);
  return { file, size: statSync(path).size };
});
const jsBytes = sum(files.filter((asset) => asset.file.endsWith(".js")));
const cssBytes = sum(files.filter((asset) => asset.file.endsWith(".css")));
const totalBytes = sum(files);
const failures = [
  ["JavaScript", jsBytes, budgets.js],
  ["CSS", cssBytes, budgets.css],
  ["Total", totalBytes, budgets.total]
].flatMap(([label, actual, limit]) =>
  actual > limit ? [`${label} bundle is ${actual} bytes; limit is ${limit} bytes.`] : []
);

console.log(
  JSON.stringify(
    {
      ok: failures.length === 0,
      budgets,
      sizes: { jsBytes, cssBytes, totalBytes },
      assets: files.sort((left, right) => right.size - left.size)
    },
    null,
    2
  )
);

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

function sum(items) {
  return items.reduce((total, item) => total + item.size, 0);
}
