import { readData, writeData, CHARACTERS_RECORD_FILE } from "@/lib/data/local-storage";
import { RawCharacterData } from "@/lib/models/rawdata-model";
import { LocalCharacterDialogueOperations } from "@/lib/data/character-dialogue-operation";
import { normalizeCharacterCard } from "@/lib/character-card/normalize";

export interface CharacterRecord {
  id: string;
  readonly protagonistName?: string;
  data: RawCharacterData;
  imagePath: string;
  created_at: string;
  updated_at: string;
  last_used_at?: string;
}

export const MAX_PROTAGONIST_NAME_LENGTH = 64;

export function normalizeProtagonistName(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error("A protagonist name is required.");
  }
  if (Array.from(normalized).length > MAX_PROTAGONIST_NAME_LENGTH) {
    throw new Error(`The protagonist name must not exceed ${MAX_PROTAGONIST_NAME_LENGTH} characters.`);
  }
  if (/[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error("The protagonist name must be a single line without control characters.");
  }
  return normalized;
}

export class LocalCharacterRecordOperations {
  static async createCharacter(
    characterId: string,
    rawCharacterData: RawCharacterData,
    imagePath: string,
    protagonistName: string,
  ): Promise<CharacterRecord> {
    const characterRecords = await readData(CHARACTERS_RECORD_FILE);
    const characterRecord: CharacterRecord = {
      id: characterId,
      protagonistName: normalizeProtagonistName(protagonistName),
      data: normalizeCharacterCard(rawCharacterData),
      imagePath,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    
    characterRecords.push(characterRecord);
    await writeData(CHARACTERS_RECORD_FILE, characterRecords);
    
    return characterRecord;
  }
  
  static async getAllCharacters(): Promise<CharacterRecord[]> {
    return await readData(CHARACTERS_RECORD_FILE);
  }
  
  static async getCharacterById(characterId: string): Promise<CharacterRecord> {
    const characterRecords = await readData(CHARACTERS_RECORD_FILE);
  
    const characterRecord = characterRecords.find(
      (record: CharacterRecord) => record.id === characterId,
    );

    return characterRecord;
  }

  static async touchCharacter(characterId: string): Promise<void> {
    const characterRecords = await readData(CHARACTERS_RECORD_FILE);
    const index = characterRecords.findIndex((record: CharacterRecord) => record.id === characterId);
    if (index === -1) {
      return;
    }
    characterRecords[index].last_used_at = new Date().toISOString();
    await writeData(CHARACTERS_RECORD_FILE, characterRecords);
  }
  
  static async updateCharacter(characterId: string, characterData: Partial<RawCharacterData>): Promise<CharacterRecord | null> {
    const characterRecords = await readData(CHARACTERS_RECORD_FILE);
    const index = characterRecords.findIndex((characterRecord: CharacterRecord) => characterRecord.id === characterId);
    
    if (index === -1) {
      return null;
    }
    
    const mutableCharacterData = { ...characterData };
    delete mutableCharacterData.protagonistName;
    const current = normalizeCharacterCard(characterRecords[index].data);
    const nestedKeys = [
      "name", "description", "personality", "first_mes", "scenario", "mes_example",
      "creator_notes", "system_prompt", "post_history_instructions", "alternate_greetings",
      "group_only_greetings", "tags", "creator", "character_version", "nickname",
    ] as const;
    const explicitNested = mutableCharacterData.data && typeof mutableCharacterData.data === "object"
      ? mutableCharacterData.data
      : {};
    const nestedPatch: Record<string, unknown> = { ...explicitNested };
    for (const key of nestedKeys) {
      if (Object.prototype.hasOwnProperty.call(mutableCharacterData, key)) {
        nestedPatch[key] = mutableCharacterData[key];
      }
    }
    characterRecords[index].data = normalizeCharacterCard({
      ...current,
      ...mutableCharacterData,
      data: { ...current.data, ...nestedPatch },
    });
    characterRecords[index].updated_at = new Date().toISOString();
    
    await writeData(CHARACTERS_RECORD_FILE, characterRecords);
    
    return characterRecords[index];
  }
  
  static async deleteCharacter(characterId: string): Promise<boolean> {
    const characterRecords = await readData(CHARACTERS_RECORD_FILE);
    const index = characterRecords.findIndex(
      (characterRecord: CharacterRecord) => characterRecord.id === characterId,
    );

    if (index === -1) {
      return false;
    }

    characterRecords.splice(index, 1);
    await writeData(CHARACTERS_RECORD_FILE, characterRecords);
    
    await LocalCharacterDialogueOperations.deleteDialogueTree(characterId);
    
    return true;
  }
}
