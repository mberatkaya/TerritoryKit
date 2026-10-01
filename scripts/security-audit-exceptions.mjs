import { readFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";

const requiredFields = [
  "ghsaId",
  "package",
  "affectedVersion",
  "affectedRange",
  "severity",
  "dependencyPaths",
  "scope",
  "reason",
  "exploitPreconditions",
  "absentPreconditions",
  "compensatingControls",
  "owner",
  "createdOn",
  "reviewOn",
  "expiresOn",
  "removalCondition"
];
const approvedGhsa = "GHSA-fx2h-pf6j-xcff";

export function inspectDocsDevServerExposure(root, read = (path) => readFileSync(path, "utf8")) {
  const issues = [];
  const rootScripts = JSON.parse(read(join(root, "package.json"))).scripts;
  const docsManifest = JSON.parse(read(join(root, "docs/package.json")));
  const docsConfig = read(join(root, "docs/.vitepress/config.ts"));

  if (rootScripts["docs:dev"] !== "pnpm --filter @territory-kit/docs dev")
    issues.push("Root docs:dev script changed; review VitePress exposure.");
  if (rootScripts["docs:build"] !== "pnpm --filter @territory-kit/docs build")
    issues.push("Root docs:build script changed; review VitePress exposure.");
  if (docsManifest.scripts.dev !== "vitepress dev .")
    issues.push("VitePress dev script changed; review network exposure.");
  if (docsManifest.scripts.build !== "vitepress build .")
    issues.push("VitePress build script changed; review release behavior.");
  if (
    Object.values(docsManifest.scripts).some((script) =>
      /\b(?:vitepress|vite)\s+dev\b.*--host\b|\bserver\.host\b/.test(script)
    )
  )
    issues.push("Documentation script exposes a Vite dev server.");
  if (/\bserver\s*:|server\.host|--host\b|\bhost\s*:/.test(docsConfig))
    issues.push("VitePress config contains server/host configuration.");

  for (const file of [
    "ci.yml",
    "release.yml",
    "dataset-registry-publish.yml",
    "turkey-dataset-build.yml"
  ]) {
    const workflow = YAML.parse(read(join(root, ".github/workflows", file)));
    for (const [jobName, job] of Object.entries(workflow.jobs ?? {})) {
      if (job["runs-on"] !== "ubuntu-latest")
        issues.push(`${file}:${jobName} is not pinned to Ubuntu for this exception.`);
      for (const step of job.steps ?? []) {
        if (typeof step.run !== "string") continue;
        if (
          /\bvitepress\s+dev\b|\bvite\s+dev\b|\bdocs:dev\b|--filter\s+@territory-kit\/docs\s+dev\b|(?:pnpm|npm)\s+(?:--dir\s+)?docs\s+dev\b/.test(
            step.run
          )
        )
          issues.push(`${file}:${jobName} starts a documentation dev server.`);
      }
    }
  }
  return { ok: issues.length === 0, issues };
}

export function evaluateAuditExceptions({ productionAudit, fullAudit, policy, exposure, today }) {
  const errors = [];
  const approvedExceptions = [];
  const rawAudit = {
    productionCritical: count(productionAudit, "critical"),
    productionHigh: count(productionAudit, "high"),
    fullCritical: count(fullAudit, "critical"),
    fullHigh: count(fullAudit, "high")
  };
  const productionAdvisories = Object.values(productionAudit.advisories ?? {});
  const fullAdvisories = Object.values(fullAudit.advisories ?? {});
  const highAdvisories = fullAdvisories.filter((item) => item.severity === "high");
  const criticalAdvisories = fullAdvisories.filter((item) => item.severity === "critical");
  const exceptions = policy?.exceptions;

  if (!Array.isArray(exceptions)) errors.push("Exception policy must contain an exceptions array.");
  if (
    Array.isArray(exceptions) &&
    (exceptions.length !== 1 || exceptions[0]?.ghsaId !== approvedGhsa)
  )
    errors.push(`Only the reviewed ${approvedGhsa} exception is authorized.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today ?? "")) errors.push("Invalid evaluation date.");
  if (
    rawAudit.productionCritical !==
      productionAdvisories.filter((item) => item.severity === "critical").length ||
    rawAudit.productionHigh !==
      productionAdvisories.filter((item) => item.severity === "high").length ||
    rawAudit.fullCritical !== criticalAdvisories.length ||
    rawAudit.fullHigh !== highAdvisories.length
  )
    errors.push("Audit metadata does not match advisory findings.");
  if (rawAudit.productionCritical > 0)
    errors.push("Production critical advisories cannot be exempted.");
  if (rawAudit.productionHigh > 0) errors.push("Production high advisories cannot be exempted.");
  if (rawAudit.fullCritical > 0) errors.push("Critical advisories cannot be exempted.");
  if (!exposure?.ok) errors.push(...(exposure?.issues ?? ["Documentation exposure check failed."]));

  const seen = new Set();
  for (const exception of Array.isArray(exceptions) ? exceptions : []) {
    const issue = validateException(exception, today);
    if (issue) {
      errors.push(issue);
      continue;
    }
    if (seen.has(exception.ghsaId)) {
      errors.push(`Duplicate exception ${exception.ghsaId}.`);
      continue;
    }
    seen.add(exception.ghsaId);
    const matches = highAdvisories.filter((item) => item.github_advisory_id === exception.ghsaId);
    if (matches.length !== 1) {
      errors.push(`Exception ${exception.ghsaId} has no unique current HIGH finding.`);
      continue;
    }
    const finding = matches[0];
    const matchesIdentity =
      finding.module_name === exception.package &&
      finding.severity === exception.severity &&
      finding.vulnerable_versions === exception.affectedRange &&
      finding.findings?.length === 1 &&
      finding.findings[0].version === exception.affectedVersion &&
      finding.findings[0].dev === true &&
      finding.findings[0].optional === false &&
      finding.findings[0].bundled === false &&
      sameStrings(finding.findings[0].paths, exception.dependencyPaths) &&
      exception.scope === "development documentation tooling only";
    if (!matchesIdentity) {
      errors.push(`Exception ${exception.ghsaId} package, version, range, scope or path mismatch.`);
      continue;
    }
    approvedExceptions.push(exception);
  }
  const unapprovedHigh = highAdvisories.filter(
    (item) => !approvedExceptions.some((exception) => exception.ghsaId === item.github_advisory_id)
  );
  const effectiveBlockingFindings = {
    critical: rawAudit.fullCritical,
    productionHigh: rawAudit.productionHigh,
    fullHigh: unapprovedHigh.length,
    unapprovedHigh: unapprovedHigh.map((item) => item.github_advisory_id ?? item.module_name),
    policyErrors: errors
  };
  return {
    rawAudit,
    approvedExceptions,
    effectiveBlockingFindings,
    ok:
      errors.length === 0 &&
      rawAudit.fullCritical === 0 &&
      rawAudit.productionCritical === 0 &&
      rawAudit.productionHigh === 0 &&
      unapprovedHigh.length === 0
  };
}

function count(audit, severity) {
  const value = audit?.metadata?.vulnerabilities?.[severity];
  return Number.isSafeInteger(value) && value >= 0 ? value : -1;
}

function sameStrings(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    [...actual].sort().every((item, index) => item === [...expected].sort()[index])
  );
}

function validDate(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  );
}

function validateException(value, today) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return "Malformed exception entry.";
  if (Object.keys(value).sort().join() !== [...requiredFields].sort().join())
    return "Malformed exception fields.";
  if (
    requiredFields
      .filter((field) => field !== "dependencyPaths")
      .some((field) => typeof value[field] !== "string" || value[field].trim() === "")
  )
    return "Malformed exception values.";
  if (
    !Array.isArray(value.dependencyPaths) ||
    value.dependencyPaths.length === 0 ||
    value.dependencyPaths.some((path) => typeof path !== "string" || !path)
  )
    return "Malformed exception paths.";
  if (!/^GHSA-[a-z0-9]+-[a-z0-9]+-[a-z0-9]+$/.test(value.ghsaId) || value.severity !== "high")
    return "Malformed exception identity.";
  if (
    ![value.createdOn, value.reviewOn, value.expiresOn].every(validDate) ||
    value.createdOn > value.reviewOn ||
    value.reviewOn > value.expiresOn ||
    value.createdOn > today ||
    today > value.reviewOn ||
    (Date.parse(`${value.expiresOn}T00:00:00Z`) - Date.parse(`${value.createdOn}T00:00:00Z`)) /
      86400000 >
      30 ||
    today > value.expiresOn
  )
    return `Exception ${value.ghsaId} is overdue, expired or has invalid dates.`;
  return null;
}
