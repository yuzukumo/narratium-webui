import { WorldBookOperations } from "@/lib/data/world-book-operation";
import { WorldBookEntry } from "@/lib/models/world-book-model";

export async function saveAdvancedWorldBookEntry(
  characterId: string, 
  entry: Partial<WorldBookEntry> & { 
    entry_id: string;
    keys: string[];
    content: string;
  },
) {
  if (!characterId) {
    throw new Error("Character ID is required");
  }

  try {
    const now = Date.now();
    const entryId = entry.entry_id;
    
    const worldBook = await WorldBookOperations.getWorldBook(characterId) || {};

    const updatedEntry: WorldBookEntry = {
      content: entry.content.trim(),
      keys: entry.keys.filter(key => key.trim() !== ""),
      secondary_keys: entry.secondary_keys?.filter(key => key.trim() !== "") || [],
      selective: entry.selective !== undefined ? entry.selective : false,
      constant: entry.constant !== undefined ? entry.constant : false,
      position: entry.position !== undefined ? entry.position : 4,
      insertion_order: entry.insertion_order || 0,
      enabled: entry.enabled !== undefined ? entry.enabled : true,
      use_regex: entry.use_regex !== undefined ? entry.use_regex : false,
      depth: entry.depth !== undefined ? entry.depth : 1,
      comment: entry.comment?.trim() || "",
      tokens: entry.tokens || undefined,
      extensions: {
        ...entry.extensions,
        position: typeof entry.position === "number" ? entry.position : 4,
        depth: entry.depth || 1,
        updatedAt: now,
        createdAt: entry.extensions?.createdAt || now,
      },
    };
    
    worldBook[entryId] = updatedEntry;
    
    const result = await WorldBookOperations.updateWorldBook(characterId, worldBook);
    
    return {
      success: result,
      entryId,
      entry: updatedEntry,
    };
  } catch (error: any) {
    console.error("Failed to save advanced world book entry:", error);
    throw new Error(`Failed to save advanced world book entry: ${error.message}`);
  }
} 
