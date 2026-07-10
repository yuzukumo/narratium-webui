import { WorldBookOperations } from "@/lib/data/world-book-operation";

export async function deleteWorldBookEntry(characterId: string, entryId: string) {
  if (!characterId || !entryId) {
    throw new Error("Character ID and Entry ID are required");
  }

  try {
    const success = await WorldBookOperations.deleteWorldBookEntry(characterId, entryId);
    
    return {
      success,
    };
  } catch (error: any) {
    console.error("Failed to delete world book entry:", error);
    throw new Error(`Failed to delete world book entry: ${error.message}`);
  }
}
