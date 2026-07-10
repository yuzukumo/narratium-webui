import { LocalCharacterRecordOperations } from "@/lib/data/character-record-operation";

interface SaveCharacterPromptsOptions {
  characterId: string;
  prompts: any;
}

export async function saveCharacterPrompts({ characterId, prompts }: SaveCharacterPromptsOptions) {
  if (!characterId || !prompts) {
    throw new Error("Missing required fields");
  }

  try {
    const character = await LocalCharacterRecordOperations.getCharacterById(characterId);
    if (!character) {
      throw new Error("Character not found");
    }

    const updatedData = {
      ...character.data,
      custom_prompts: prompts,
    };

    const updatedCharacter = await LocalCharacterRecordOperations.updateCharacter(characterId, updatedData);

    return { success: true, character: updatedCharacter };
  } catch (error) {
    console.error("Error saving character prompts:", error);
    throw new Error("Failed to save character prompts");
  }
}
