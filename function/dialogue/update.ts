import { LocalCharacterRecordOperations } from "@/lib/data/character-record-operation";

export async function updateCharacter(
  character_id: string,
  character_data: any,
): Promise<{ success: true; character: any }> {
  try {
    const existingCharacter = await LocalCharacterRecordOperations.getCharacterById(character_id);
    if (!existingCharacter) {
      throw new Error("Character not found");
    }

    const updatedCharacter = await LocalCharacterRecordOperations.updateCharacter(character_id, character_data);
    if (!updatedCharacter) {
      throw new Error("Failed to update character");
    }

    return {
      success: true,
      character: updatedCharacter,
    };
  } catch (error: any) {
    console.error("Failed to update character:", error);
    throw new Error(`Failed to update character: ${error.message}`);
  }
}
