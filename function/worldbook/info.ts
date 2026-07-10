import { WorldBookOperations } from "@/lib/data/world-book-operation";

export async function getWorldBookEntries(characterId: string) {
  if (!characterId) {
    throw new Error("Character ID is required");
  }

  try {
    const worldBook = await WorldBookOperations.getWorldBook(characterId);
    const entries = worldBook ? Object.entries(worldBook).map(([key, entry]) => {
      return {
        entry_id: key,
        id: entry.id,
        content: entry.content || "",
        keys: entry.keys || [],
        secondary_keys: entry.secondary_keys || [],
        selective: entry.selective !== undefined ? entry.selective : false,
        constant: entry.constant !== undefined ? entry.constant : false,
        position: entry.position !== undefined ? entry.position : 4,
        insertion_order: entry.insertion_order || 0,
        enabled: entry.enabled !== undefined ? entry.enabled : true,
        use_regex: entry.use_regex !== undefined ? entry.use_regex : false,
        depth: entry.depth || 1,
        comment: entry.comment || "",
        tokens: entry.content ? entry.content.length : 0,
        extensions: entry.extensions || {},
        primaryKey: Array.isArray(entry.keys) && entry.keys.length > 0 ? entry.keys[0] : "",
        keyCount: Array.isArray(entry.keys) ? entry.keys.length : 0,
        secondaryKeyCount: Array.isArray(entry.secondary_keys) ? entry.secondary_keys.length : 0,
        contentLength: entry.content ? entry.content.length : 0,
        isActive: entry.enabled !== false,
        lastUpdated: entry.extensions?.updatedAt || entry.extensions?.createdAt || Date.now(),
        isImported: entry.extensions?.imported || false,
        importedAt: entry.extensions?.importedAt || null,
      };
    }) : [];

    entries.sort((a, b) => {
      const positionA = typeof a.position === "number" ? a.position : 4;
      const positionB = typeof b.position === "number" ? b.position : 4;
      
      if (positionA !== positionB) {
        return positionA - positionB;
      }

      if (a.insertion_order !== b.insertion_order) {
        return a.insertion_order - b.insertion_order;
      }
      
      const lastUpdatedComparison = b.lastUpdated - a.lastUpdated;
      if (lastUpdatedComparison !== 0) {
        return lastUpdatedComparison;
      }

      return a.entry_id.localeCompare(b.entry_id);
    });

    return {
      success: true,
      entries,
      totalCount: entries.length,
      enabledCount: entries.filter(e => e.isActive).length,
      disabledCount: entries.filter(e => !e.isActive).length,
    };
  } catch (error: any) {
    console.error("Failed to get world book entries:", error);
    throw new Error(`Failed to get world book entries: ${error.message}`);
  }
}
