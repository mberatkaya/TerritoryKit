import { describe, expect, it } from "vitest";
import { serializeNationalJsonChunks } from "../src/national-json.js";

describe("national JSON chunk serialization", () => {
  it("matches compact JSON for large arrays and indexed objects", () => {
    const payload = {
      zones: [
        {
          id: "a",
          coordinates: [
            [0, 1],
            [2, 3]
          ],
          absent: undefined
        },
        null
      ],
      byId: { a: { id: "a", bbox: [0, 1, 2, 3] } },
      omit: undefined
    };
    expect([...serializeNationalJsonChunks(payload)].join("")).toBe(`${JSON.stringify(payload)}\n`);
  });
});
