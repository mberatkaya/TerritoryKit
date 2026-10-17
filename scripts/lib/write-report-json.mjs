import { writeFile } from "node:fs/promises";
import prettier from "prettier";

/**
 * Write JSON reports with Prettier so `pnpm format:check` stays green after regeneration.
 */
async function formatReportArtifact(absolutePath, raw) {
  const config = await prettier.resolveConfig(absolutePath);
  return prettier.format(raw, { ...config, filepath: absolutePath });
}

export async function writeReportJson(absolutePath, value) {
  const raw = `${JSON.stringify(value, null, 2)}\n`;
  const formatted = await formatReportArtifact(absolutePath, raw);
  await writeFile(absolutePath, formatted, "utf8");
}

export async function writeReportMarkdown(absolutePath, body) {
  const raw = `${body}\n`;
  const formatted = await formatReportArtifact(absolutePath, raw);
  await writeFile(absolutePath, formatted, "utf8");
}

/**
 * GeoJSON map previews use the same Prettier pipeline as JSON reports.
 */
export async function writeReportGeoJson(absolutePath, value) {
  const raw = `${JSON.stringify(value, null, 2)}\n`;
  const formatted = await formatReportArtifact(absolutePath, raw);
  await writeFile(absolutePath, formatted, "utf8");
}
