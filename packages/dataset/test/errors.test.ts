import { describe, expect, it } from "vitest";
import {
  TERRITORY_ERROR_CODES,
  TerritoryDatasetValidationError,
  TerritoryError,
  deserializeTerritoryError,
  isTerritoryError,
  loadTerritoryDataset,
  serializeTerritoryError
} from "../src/index.js";

describe("territory error model", () => {
  it("constructs stable coded errors and preserves Error behavior", () => {
    const cause = new Error("network failed");
    const error = new TerritoryError("ARTIFACT_NOT_FOUND", "Artifact missing.", {
      cause,
      details: {
        artifactId: "adm2",
        token: "secret",
        nested: { value: 1 }
      }
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("ARTIFACT_NOT_FOUND");
    expect(error.cause).toBe(cause);
    expect(error.details).toMatchObject({
      artifactId: "adm2",
      token: "[Redacted]",
      nested: { value: 1 }
    });
    expect(isTerritoryError(error)).toBe(true);
  });

  it("keeps error codes stable", () => {
    expect(TERRITORY_ERROR_CODES).toEqual([
      "UNKNOWN",
      "ZONE_NOT_FOUND",
      "INVALID_COORDINATE",
      "INVALID_BOUNDS",
      "INVALID_LEVEL",
      "INVALID_NEIGHBOR_DISTANCE",
      "ENGINE_STATE_INVALID",
      "DATASET_INVALID",
      "DATASET_SCHEMA_UNSUPPORTED",
      "DATASET_VERSION_UNSUPPORTED",
      "GEOMETRY_INVALID",
      "DATASET_NOT_FOUND",
      "ARTIFACT_NOT_FOUND",
      "CHECKSUM_MISMATCH",
      "ARTIFACT_CORRUPTED",
      "CACHE_CORRUPTED",
      "DOWNLOAD_TIMEOUT",
      "REQUEST_ABORTED",
      "RUNTIME_DISPOSED",
      "RUNTIME_NOT_READY",
      "RUNTIME_CONFIGURATION_INVALID",
      "CAPABILITY_UNSUPPORTED",
      "ADAPTER_NOT_ATTACHED",
      "ADAPTER_DISPOSED",
      "ADAPTER_TARGET_INVALID"
    ]);
  });

  it("serializes and deserializes without stacks or sensitive details", () => {
    const serialized = serializeTerritoryError(
      new TerritoryError("CHECKSUM_MISMATCH", "Checksum mismatch.", {
        cause: new TerritoryError("ARTIFACT_CORRUPTED", "Corrupted."),
        details: { password: "do-not-emit", path: "levels/ADM0/dataset.json" }
      })
    );

    expect(serialized).toEqual({
      name: "TerritoryError",
      message: "Checksum mismatch.",
      code: "CHECKSUM_MISMATCH",
      details: { password: "[Redacted]", path: "levels/ADM0/dataset.json" },
      cause: {
        name: "TerritoryError",
        message: "Corrupted.",
        code: "ARTIFACT_CORRUPTED"
      }
    });
    expect("stack" in serialized).toBe(false);

    const deserialized = deserializeTerritoryError(serialized);
    expect(deserialized).toBeInstanceOf(TerritoryError);
    expect(deserialized.code).toBe("CHECKSUM_MISMATCH");
    expect(deserialized.cause).toBeInstanceOf(TerritoryError);
  });

  it("wraps unknown errors into UNKNOWN serialization", () => {
    expect(serializeTerritoryError("boom")).toMatchObject({
      name: "TerritoryError",
      message: "Unknown TerritoryKit error.",
      code: "UNKNOWN"
    });
  });

  it("handles serialization and sanitization edge cases", () => {
    const fallbackError = new Error("");
    fallbackError.name = "";
    const errorWithEmptyCause = new Error("outer", { cause: fallbackError });

    expect(serializeTerritoryError(fallbackError)).toMatchObject({
      name: "Error",
      message: "Unknown TerritoryKit error.",
      code: "UNKNOWN"
    });
    expect(serializeTerritoryError(errorWithEmptyCause).cause).toEqual({
      name: "Error",
      message: "Unknown error"
    });

    const coded = new TerritoryError("UNKNOWN", "Has odd details.", {
      cause: "raw cause",
      details: {
        empty: undefined,
        nan: Number.NaN,
        infinity: Number.POSITIVE_INFINITY,
        big: 1n,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        cookie: "session",
        values: [1, undefined, () => "skip"],
        nested: { secretValue: "hidden", ok: true },
        deep: { a: { b: { c: { d: { e: "truncated" } } } } },
        unsupported: Symbol("skip")
      }
    });

    expect(coded.details).toMatchObject({
      nan: "NaN",
      infinity: "Infinity",
      big: "1",
      createdAt: "2026-01-01T00:00:00.000Z",
      cookie: "[Redacted]",
      values: [1],
      nested: { secretValue: "[Redacted]", ok: true },
      deep: { a: { b: { c: { d: "[Truncated]" } } } }
    });
    expect(coded.details).not.toHaveProperty("empty");
    expect(coded.details).not.toHaveProperty("unsupported");
    expect(serializeTerritoryError(coded).cause).toEqual({
      name: "Error",
      message: "Unknown error"
    });
  });

  it("deserializes invalid and partial payloads safely", () => {
    expect(deserializeTerritoryError("bad")).toMatchObject({
      code: "UNKNOWN",
      message: "Unknown TerritoryKit error."
    });

    const deserialized = deserializeTerritoryError({
      code: "NOT_A_REAL_CODE",
      message: 123,
      details: { authorization: "Bearer token" },
      cause: { name: 42, message: 99 }
    });

    expect(deserialized).toMatchObject({
      code: "UNKNOWN",
      message: "Unknown TerritoryKit error.",
      details: { authorization: "[Redacted]" }
    });
    expect(deserialized.cause).toBeInstanceOf(Error);
    expect(
      deserializeTerritoryError({
        code: "UNKNOWN",
        message: "Missing cause record.",
        cause: "raw"
      }).cause
    ).toBeUndefined();
  });

  it("keeps existing dataset validation errors backward-compatible", () => {
    expect(() => loadTerritoryDataset(null)).toThrow(TerritoryDatasetValidationError);

    try {
      loadTerritoryDataset(null);
    } catch (error) {
      expect(error).toBeInstanceOf(TerritoryError);
      expect(isTerritoryError(error)).toBe(true);
      expect(error).toMatchObject({ code: "DATASET_INVALID" });
    }
  });
});
