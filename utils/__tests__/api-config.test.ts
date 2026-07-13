import { describe, expect, it } from "vitest";
import {
  calculateContextOutputReserve,
  calculateRequestMaxOutputTokens,
  sanitizeResponseLength,
} from "@/utils/api-config";

describe("response length and physical output limits", () => {
  it("keeps the response-length preference as an uncapped character target", () => {
    expect(sanitizeResponseLength("250000")).toBe(250000);
  });

  it("derives context headroom from model capabilities rather than the response preference", () => {
    expect(calculateContextOutputReserve(272000, 258000, 128000)).toBe(14000);
    expect(calculateContextOutputReserve(128000, 120000, 4096)).toBe(4096);
  });

  it("uses the model limit until the actual prompt leaves less context space", () => {
    expect(calculateRequestMaxOutputTokens(272000, 100000, 128000)).toBe(128000);
    expect(calculateRequestMaxOutputTokens(272000, 258000, 128000)).toBe(14000);
  });
});
