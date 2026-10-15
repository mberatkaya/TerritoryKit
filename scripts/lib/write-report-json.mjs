import { writeFile } from "node:fs/promises";
import prettier from "prettier";

/**
 * Write JSON reports with Prettier so `pnpm format:check` stays green after regeneration.
 */
export async function writeReportJson(absolutePath, value) {
  const raw = `${JSON.stringify(value, null, 2)}\n`;
  const formatted = await prettier.format(raw, { filepath: absolutePath });
  await writeFile(absolutePath, formatted, "utf8");
}

export async function writeReportMarkdown(absolutePath, body) {
  const raw = `${body}\n`;
  const formatted = await prettier.format(raw, { filepath: absolutePath });
  await writeFile(absolutePath, formatted, "utf8");
}
