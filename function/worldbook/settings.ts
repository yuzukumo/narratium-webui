import { WorldBookOperations, WorldBookSettings } from "@/lib/data/world-book-operation";

export async function getWorldBookSettings(characterId: string) {
  if (!characterId) {
    throw new Error("Character ID is required");
  }

  try {
    const settings = await WorldBookOperations.getWorldBookSettings(characterId);
    
    return {
      success: true,
      settings,
    };
  } catch (error: any) {
    console.error("Failed to get world book settings:", error);
    throw new Error(`Failed to get world book settings: ${error.message}`);
  }
}

export async function updateWorldBookSettings(
  characterId: string,
  updates: Partial<WorldBookSettings>,
) {
  if (!characterId) {
    throw new Error("Character ID is required");
  }

  if (updates.maxEntries !== undefined && (updates.maxEntries < 0 || updates.maxEntries > 50)) {
    throw new Error("Max entries must be between 0 and 50");
  }

  if (updates.contextWindow !== undefined && (updates.contextWindow < 1 || updates.contextWindow > 20)) {
    throw new Error("Context window must be between 1 and 20");
  }

  try {
    const newSettings = await WorldBookOperations.updateWorldBookSettings(characterId, updates);
    
    return {
      success: true,
      settings: newSettings,
    };
  } catch (error: any) {
    console.error("Failed to update world book settings:", error);
    throw new Error(`Failed to update world book settings: ${error.message}`);
  }
} 
