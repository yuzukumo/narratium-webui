import { beforeEach, describe, expect, it, vi } from "vitest";
import { zipSync } from "fflate";

const persistence = vi.hoisted(() => ({
  createCharacter: vi.fn(),
  deleteCharacter: vi.fn(),
  setBlob: vi.fn(),
  deleteBlob: vi.fn(),
  updateWorldBook: vi.fn(),
  deleteWorldBook: vi.fn(),
  updateRegexScripts: vi.fn(),
  updateRegexScriptSettings: vi.fn(),
  deleteRegexScripts: vi.fn(),
}));

vi.mock("@/lib/data/character-record-operation", () => ({
  normalizeProtagonistName: (value: string) => {
    const normalized = value.trim();
    if (!normalized) throw new Error("A protagonist name is required.");
    return normalized;
  },
  LocalCharacterRecordOperations: {
    createCharacter: persistence.createCharacter,
    deleteCharacter: persistence.deleteCharacter,
  },
}));

vi.mock("@/lib/data/local-storage", () => ({
  setBlob: persistence.setBlob,
  deleteBlob: persistence.deleteBlob,
}));

vi.mock("@/lib/data/world-book-operation", () => ({
  WorldBookOperations: {
    updateWorldBook: persistence.updateWorldBook,
    deleteWorldBook: persistence.deleteWorldBook,
  },
}));

vi.mock("@/lib/data/regex-script-operation", () => ({
  RegexScriptOperations: {
    updateRegexScripts: persistence.updateRegexScripts,
    updateRegexScriptSettings: persistence.updateRegexScriptSettings,
    deleteRegexScripts: persistence.deleteRegexScripts,
  },
}));

import { handleCharacterUpload } from "@/function/character/import";

function charXFixture(): File {
  const card = {
    spec: "chara_card_v3",
    spec_version: "3.0",
    data: {
      name: "Nova",
      character_book: {
        entries: [{
          keys: ["bridge"],
          content: "The bridge is quiet.",
          enabled: true,
          insertion_order: 1,
          position: "after_char",
          extensions: {},
        }],
        extensions: {},
      },
      assets: [
        { type: "icon", name: "main", ext: "png", uri: "embedded://assets/icon.png" },
        { type: "background", name: "bridge", ext: "webp", uri: "__asset:assets/bridge.webp" },
      ],
      extensions: {
        regex_scripts: [{
          id: "remove-status",
          scriptName: "Remove status",
          findRegex: "<status>[\\s\\S]*?</status>",
          replaceString: "",
          trimStrings: [],
          placement: [2],
        }],
      },
    },
  };
  const archive = zipSync({
    "card.json": new TextEncoder().encode(JSON.stringify(card)),
    "assets/icon.png": new Uint8Array([137, 80, 78, 71]),
    "assets/bridge.webp": new Uint8Array([82, 73, 70, 70]),
  });
  return new File([archive], "nova.charx", { type: "application/zip" });
}

beforeEach(() => {
  for (const mock of Object.values(persistence)) {
    mock.mockReset().mockResolvedValue(true);
  }
});

describe("character import persistence", () => {
  it("stores the card, embedded assets, world book, and disabled-by-default regex", async () => {
    const result = await handleCharacterUpload(charXFixture(), {
      protagonistName: " Alice ",
    });

    expect(result.success).toBe(true);
    expect(result.hasWorldBook).toBe(true);
    expect(result.hasRegexScripts).toBe(true);
    expect(result.embeddedRegexScriptsDisabled).toBe(true);
    expect(persistence.createCharacter).toHaveBeenCalledOnce();
    expect(persistence.createCharacter.mock.calls[0][3]).toBe("Alice");
    expect(persistence.setBlob).toHaveBeenCalledTimes(2);
    expect(persistence.updateWorldBook).toHaveBeenCalledOnce();
    expect(persistence.updateRegexScripts).toHaveBeenCalledOnce();
    const importedScripts = persistence.updateRegexScripts.mock.calls[0][1] as Array<{ disabled: boolean }>;
    expect(importedScripts[0].disabled).toBe(true);
    expect(persistence.updateRegexScriptSettings).toHaveBeenCalledWith(
      result.characterId,
      { enabled: true, applyToPrompt: true, applyToResponse: true },
    );
  });

  it("rolls back records and blobs when an asset write fails", async () => {
    persistence.setBlob
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("blob unavailable"));

    await expect(handleCharacterUpload(charXFixture(), {
      protagonistName: "Alice",
      trustEmbeddedRegex: true,
    })).rejects.toThrow("blob unavailable");

    expect(persistence.deleteCharacter).toHaveBeenCalledOnce();
    expect(persistence.deleteWorldBook).toHaveBeenCalledOnce();
    expect(persistence.deleteRegexScripts).toHaveBeenCalledOnce();
    expect(persistence.deleteBlob).toHaveBeenCalledTimes(2);
  });
});
