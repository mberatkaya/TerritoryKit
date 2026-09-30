import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, symlinkSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const root = mkdtempSync(join(tmpdir(), "territory-workflow-"));
writeFileSync(join(root, "source.json"), "{}");
symlinkSync("/etc/hosts", join(root, "escape.json"));
const script = new URL("./validate-workflow-inputs.mjs", import.meta.url).pathname;
function accepts(value) {
  try {
    execFileSync(process.execPath, [script], {
      env: { ...process.env, GITHUB_WORKSPACE: root, INPUT_SOURCE_LOCK: value },
      stdio: "ignore"
    });
    return true;
  } catch {
    return false;
  }
}
test("workflow paths remain inside the checkout", () => {
  assert.equal(accepts("source.json"), true);
  for (const value of [
    "../escape.json",
    "/etc/hosts",
    "C:\\Windows\\config.json",
    "escape.json",
    "source.json\ncommand"
  ])
    assert.equal(accepts(value), false, value);
});
test("workflow run blocks do not interpolate dispatch input as shell source", () => {
  const workflowRoot = new URL("../.github/workflows/", import.meta.url).pathname;
  for (const file of readdirSync(workflowRoot).filter((name) => name.endsWith(".yml"))) {
    const lines = readFileSync(join(workflowRoot, file), "utf8").split("\n");
    let runIndent = -1;
    for (const line of lines) {
      const indent = line.length - line.trimStart().length;
      if (runIndent >= 0 && line.trim() && indent <= runIndent) runIndent = -1;
      if (/^\s*run:\s*\|/.test(line)) {
        runIndent = indent;
        continue;
      }
      if (runIndent >= 0) assert.doesNotMatch(line, /\$\{\{\s*inputs\./, `${file}: ${line}`);
    }
  }
});
