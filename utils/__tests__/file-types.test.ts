import { describe, expect, it } from "vitest";
import { isJSONFile } from "@/utils/file-types";

describe("JSON file detection", () => {
  it("accepts JSON by extension when browsers omit the MIME type", () => {
    expect(isJSONFile({ name: "world-book.JSON", type: "" })).toBe(true);
  });

  it("accepts JSON MIME types and rejects unrelated files", () => {
    expect(isJSONFile({ name: "preset", type: "application/json" })).toBe(true);
    expect(isJSONFile({ name: "notes.txt", type: "text/plain" })).toBe(false);
  });
});
