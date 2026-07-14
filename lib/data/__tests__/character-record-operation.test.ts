import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeCharacterCard } from "@/lib/character-card/normalize";
import type { RawCharacterData } from "@/lib/models/rawdata-model";

const storage = vi.hoisted(() => ({
  records: [] as unknown[],
  readData: vi.fn(),
  writeData: vi.fn(),
}));

vi.mock("@/lib/data/local-storage", () => ({
  CHARACTERS_RECORD_FILE: "characters_record",
  CHARACTER_DIALOGUES_FILE: "character_dialogues",
  readData: storage.readData,
  writeData: storage.writeData,
}));

import {
  LocalCharacterRecordOperations,
  MAX_PROTAGONIST_NAME_LENGTH,
  normalizeProtagonistName,
  type CharacterRecord,
} from "@/lib/data/character-record-operation";

beforeEach(() => {
  storage.records = [];
  storage.readData.mockReset().mockImplementation(async () => storage.records);
  storage.writeData.mockReset().mockImplementation(async (_namespace, value) => {
    storage.records = value;
  });
});

describe("protagonist names", () => {
  it("normalizes valid names and rejects blank, multiline, control, and overlong values", () => {
    expect(normalizeProtagonistName("  Alice  ")).toBe("Alice");
    expect(normalizeProtagonistName("界".repeat(MAX_PROTAGONIST_NAME_LENGTH)))
      .toBe("界".repeat(MAX_PROTAGONIST_NAME_LENGTH));
    expect(() => normalizeProtagonistName("   ")).toThrow();
    expect(() => normalizeProtagonistName("Alice\nBob")).toThrow();
    expect(() => normalizeProtagonistName("Alice\u0000Bob")).toThrow();
    expect(() => normalizeProtagonistName("界".repeat(MAX_PROTAGONIST_NAME_LENGTH + 1))).toThrow();
  });

  it("stores the normalized name when a character is imported", async () => {
    const created = await LocalCharacterRecordOperations.createCharacter(
      "character-1",
      normalizeCharacterCard({ data: { name: "Nova" } }),
      "character-1.png",
      "  Alice  ",
      "characters/character-1/thumbnail.webp",
    );

    expect(created.protagonistName).toBe("Alice");
    expect((storage.records[0] as CharacterRecord).protagonistName).toBe("Alice");
    expect((storage.records[0] as CharacterRecord).thumbnailPath).toBe("characters/character-1/thumbnail.webp");
  });

  it("preserves the imported name even when an update payload tries to replace it", async () => {
    storage.records = [{
      id: "character-1",
      protagonistName: "Alice",
      data: normalizeCharacterCard({ data: { name: "Nova" } }),
      imagePath: "character-1.png",
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString(),
    } satisfies CharacterRecord];

    const update = {
      name: "Nova Prime",
      protagonistName: "Mallory",
    } as Partial<RawCharacterData>;
    const result = await LocalCharacterRecordOperations.updateCharacter("character-1", update);

    expect(result?.protagonistName).toBe("Alice");
    expect(result?.data.data.name).toBe("Nova Prime");
    expect(result?.data).not.toHaveProperty("protagonistName");
  });

  it("records the last-used time without changing character content", async () => {
    const record = {
      id: "character-1",
      protagonistName: "Alice",
      data: normalizeCharacterCard({ data: { name: "Nova" } }),
      imagePath: "character-1.png",
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString(),
    } satisfies CharacterRecord;
    storage.records = [record];

    await LocalCharacterRecordOperations.touchCharacter("character-1");

    const saved = storage.records[0] as CharacterRecord;
    expect(Date.parse(saved.last_used_at || "")).toBeGreaterThan(0);
    expect(saved.updated_at).toBe(record.updated_at);
    expect(saved.data.data.name).toBe("Nova");
  });
});
