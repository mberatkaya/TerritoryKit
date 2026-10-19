import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveSafeCandidateFile } from "../src/safe-candidate-path.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const candidateRoot = path.join(repoRoot, ".territory/sprint-3/playable-v3/candidate");

describe("resolveSafeCandidateFile", () => {
  it("allows registry.json under the candidate root", () => {
    const resolved = resolveSafeCandidateFile(candidateRoot, "registry.json");
    expect(resolved).toBe(path.join(candidateRoot, "registry.json"));
  });

  it("blocks path traversal and encoded traversal", () => {
    expect(resolveSafeCandidateFile(candidateRoot, "../package.json")).toBeNull();
    expect(resolveSafeCandidateFile(candidateRoot, "..%2fpackage.json")).toBeNull();
    expect(resolveSafeCandidateFile(candidateRoot, "%2e%2e%2fpackage.json")).toBeNull();
    expect(resolveSafeCandidateFile(candidateRoot, "render/../../package.json")).toBeNull();
  });

  it("rejects malformed percent-encoding", () => {
    expect(resolveSafeCandidateFile(candidateRoot, "%E0%A4%A")).toBeNull();
  });
});
