import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RegexScript } from "@/lib/models/regex-script-model";

const storage = vi.hoisted(() => ({
  readData: vi.fn(),
  writeData: vi.fn(),
  inheritDataRevision: vi.fn(),
}));

vi.mock("@/lib/data/local-storage", () => ({
  REGEX_SCRIPTS_FILE: "regex_scripts",
  readData: storage.readData,
  writeData: storage.writeData,
  inheritDataRevision: storage.inheritDataRevision,
}));

import { RegexScriptOperations } from "@/lib/data/regex-script-operation";

const script: RegexScript = {
  scriptKey: "script-1",
  scriptName: "Test",
  findRegex: "TARGET",
  replaceString: "replacement",
  trimStrings: [],
  placement: [2],
};

beforeEach(() => {
  storage.readData.mockReset().mockResolvedValue([{}]);
  storage.writeData.mockReset().mockResolvedValue(undefined);
  storage.inheritDataRevision.mockReset();
});

describe("regex script persistence failures", () => {
  it("propagates read failures without attempting a destructive write", async () => {
    storage.readData.mockRejectedValueOnce(new Error("read unavailable"));

    await expect(RegexScriptOperations.updateRegexScripts("character-1", [script]))
      .rejects.toThrow("read unavailable");
    expect(storage.writeData).not.toHaveBeenCalled();
  });

  it("propagates write failures instead of reporting success", async () => {
    storage.writeData.mockRejectedValueOnce(new Error("write unavailable"));

    await expect(RegexScriptOperations.updateRegexScripts("character-1", [script]))
      .rejects.toThrow("write unavailable");
  });
});
