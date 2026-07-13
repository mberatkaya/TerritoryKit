import type { TerritoryValidationIssue } from "./types.js";

export class TerritoryDatasetValidationError extends Error {
  readonly issues: TerritoryValidationIssue[];

  constructor(issues: TerritoryValidationIssue[]) {
    const summary = issues
      .slice(0, 3)
      .map((issue) => `${issue.code} at ${issue.path}`)
      .join(", ");

    super(
      `Territory dataset validation failed with ${issues.length} issue(s)${
        summary.length > 0 ? `: ${summary}` : ""
      }`
    );

    this.name = "TerritoryDatasetValidationError";
    this.issues = issues;
  }
}
