import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildNationalSearchIndex,
  normalizeSearchText,
  searchZonesFromNationalIndex,
  type NationalQueryArtifactPayload
} from "../src/national-search-index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const queryArtifactPath = path.join(
  repoRoot,
  ".territory/sprint-3/playable-v3/candidate/query/query-artifact.json"
);

describe("national search index", () => {
  it("folds ASCII Turkish queries to match dotted district names", () => {
    expect(normalizeSearchText("kadikoy")).toBe(normalizeSearchText("Kadıköy"));
  });

  it("indexes all ADM2 districts from the national query artifact when present locally", () => {
    if (!existsSync(queryArtifactPath)) {
      return;
    }

    const artifact = JSON.parse(
      readFileSync(queryArtifactPath, "utf8")
    ) as NationalQueryArtifactPayload;
    const index = buildNationalSearchIndex(artifact);

    expect(index.report.adm2Indexed).toBe(973);
    expect(index.report.missingNameIds).toEqual([]);

    const zones = searchZonesFromNationalIndex(index, ["ADM2"]);
    const findByQuery = (query: string, preferId?: string) => {
      const normalized = normalizeSearchText(query);
      const matches = zones.filter((zone) => {
        const haystack = normalizeSearchText(
          [zone.name, zone.localName, ...(index.searchAliasesById.get(zone.id) ?? [])]
            .filter(Boolean)
            .join(" ")
        );
        return haystack.includes(normalized);
      });
      return preferId ? matches.find((zone) => zone.id === preferId) : matches[0];
    };

    expect(findByQuery("fatih", "tr:adm2:54988432b39641834885080")?.name).toBe("Fatih");
    expect(findByQuery("kadikoy", "tr:adm2:54988432b89638439219394")?.name).toBe("Kadıköy");
    expect(findByQuery("adalar", "tr:adm2:54988432b94516152709384")?.name).toBe("Prince Islands");
    expect(findByQuery("cankaya", "tr:adm2:54988432b72030220276956")?.name).toBe("Çankaya");
  });
});
