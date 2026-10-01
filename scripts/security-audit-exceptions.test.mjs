import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  evaluateAuditExceptions,
  inspectDocsDevServerExposure
} from "./security-audit-exceptions.mjs";

const root = process.cwd();
const policy = JSON.parse(
  readFileSync(join(root, "reports/baselines/sprint-7-security-exceptions.json"))
);
const exception = policy.exceptions[0];
const finding = {
  github_advisory_id: exception.ghsaId,
  module_name: "vite",
  vulnerable_versions: exception.affectedRange,
  severity: "high",
  findings: [
    {
      version: exception.affectedVersion,
      paths: exception.dependencyPaths,
      dev: true,
      optional: false,
      bundled: false
    }
  ]
};

function audit(advisories = []) {
  return {
    metadata: {
      vulnerabilities: {
        critical: advisories.filter((item) => item.severity === "critical").length,
        high: advisories.filter((item) => item.severity === "high").length
      }
    },
    advisories: Object.fromEntries(advisories.map((item, index) => [index, item]))
  };
}

function decide({
  production = audit(),
  full = audit([finding]),
  currentPolicy = policy,
  exposure = { ok: true, issues: [] },
  today = "2026-10-01"
} = {}) {
  return evaluateAuditExceptions({
    productionAudit: production,
    fullAudit: full,
    policy: currentPolicy,
    exposure,
    today
  });
}

test("exact, current docs-only HIGH is approved while raw count remains one", () => {
  const result = decide();
  assert.equal(result.ok, true);
  assert.equal(result.rawAudit.fullHigh, 1);
  assert.equal(result.effectiveBlockingFindings.fullHigh, 0);
  assert.deepEqual(
    result.approvedExceptions.map((item) => item.ghsaId),
    [exception.ghsaId]
  );
});

test("a different HIGH remains blocking", () => {
  const other = { ...finding, github_advisory_id: "GHSA-aaaa-bbbb-cccc" };
  const result = decide({ full: audit([finding, other]) });
  assert.equal(result.ok, false);
  assert.equal(result.effectiveBlockingFindings.fullHigh, 1);
});

test("CRITICAL and production HIGH cannot be exempted", () => {
  assert.equal(decide({ full: audit([finding, { ...finding, severity: "critical" }]) }).ok, false);
  assert.equal(decide({ production: audit([finding]) }).ok, false);
});

test("expired exception fails", () => {
  assert.equal(decide({ today: "2026-10-16" }).ok, false);
  assert.equal(decide({ today: "2026-10-30" }).ok, false);
  assert.equal(
    decide({ currentPolicy: { exceptions: [{ ...exception, expiresOn: "2026-11-15" }] } }).ok,
    false
  );
});

test("package, version, range and dependency-path changes fail", () => {
  for (const changed of [
    { ...finding, module_name: "other" },
    { ...finding, findings: [{ ...finding.findings[0], version: "5.4.22" }] },
    { ...finding, vulnerable_versions: "<6.4.3" },
    { ...finding, findings: [{ ...finding.findings[0], paths: ["docs>other>vite"] }] }
  ])
    assert.equal(decide({ full: audit([changed]) }).ok, false);
});

test("malformed and duplicate exception policy fails closed", () => {
  assert.equal(decide({ currentPolicy: { exceptions: [{ ghsaId: exception.ghsaId }] } }).ok, false);
  assert.equal(decide({ currentPolicy: { exceptions: [exception, exception] } }).ok, false);
  assert.equal(decide({ currentPolicy: { exceptions: [] } }).ok, false);
});

test("current docs and workflow configuration does not expose VitePress dev", () => {
  assert.deepEqual(inspectDocsDevServerExposure(root), { ok: true, issues: [] });
});

test("docs --host, server.host and workflow dev commands invalidate exposure check", () => {
  const source = (path) => readFileSync(path, "utf8");
  const withChange = (suffix, mutate) =>
    inspectDocsDevServerExposure(root, (path) =>
      path.endsWith(suffix) ? mutate(source(path)) : source(path)
    );
  for (const exposure of [
    withChange("docs/package.json", (value) =>
      value.replace("vitepress dev .", "vitepress dev . --host 0.0.0.0")
    ),
    withChange("docs/.vitepress/config.ts", (value) =>
      value.replace("title:", "server: { host: '0.0.0.0' }, title:")
    ),
    withChange(".github/workflows/ci.yml", (value) =>
      value.replace("run: pnpm verify", "run: pnpm docs:dev")
    )
  ]) {
    assert.equal(exposure.ok, false);
    assert.equal(decide({ exposure }).ok, false);
  }
});
