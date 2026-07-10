import { WorldBookOperations, WorldBookSettings } from "@/lib/data/world-book-operation";
import { WorldBookEntry } from "@/lib/models/world-book-model";

export interface GlobalWorldBook {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
  entryCount: number;
  sourceCharacterId?: string;
  sourceCharacterName?: string;
}

export interface GlobalWorldBookResult {
  success: boolean;
  message: string;
  globalId?: string;
  worldBook?: GlobalWorldBook;
}

export interface ListGlobalWorldBooksResult {
  success: boolean;
  globalWorldBooks: GlobalWorldBook[];
  message?: string;
}

export async function getNextGlobalId(): Promise<string> {
  try {
    const result = await listGlobalWorldBooks();
    if (!result.success) {
      return "global_1";
    }

    const existingIds = result.globalWorldBooks.map(book => {
      const match = book.id.match(/^global_(\d+)$/);
      return match ? parseInt(match[1], 10) : 0;
    });

    const maxId = existingIds.length > 0 ? Math.max(...existingIds) : 0;
    return `global_${maxId + 1}`;
  } catch (error) {
    console.error("Failed to get next global ID:", error);
    return "global_1";
  }
}

export async function saveAsGlobalWorldBook(
  characterId: string,
  name: string,
  description?: string,
  sourceCharacterName?: string,
): Promise<GlobalWorldBookResult> {
  try {
    const worldBook = await WorldBookOperations.getWorldBook(characterId);
    if (!worldBook) {
      return {
        success: false,
        message: "Character world book not found",
      };
    }

    const globalId = await getNextGlobalId();
    const now = Date.now();

    const globalWorldBook: Record<string, WorldBookEntry> = {};
    Object.entries(worldBook).forEach(([entryId, entry]) => {
      globalWorldBook[entryId] = {
        ...entry,
        extensions: {
          ...entry.extensions,
          imported: true,
          importedAt: now,
          globalSource: true,
          sourceCharacterId: characterId,
          sourceCharacterName,
        },
      };
    });

    await WorldBookOperations.updateWorldBook(globalId, globalWorldBook);

    const metadata: GlobalWorldBook = {
      id: globalId,
      name,
      description,
      createdAt: now,
      updatedAt: now,
      entryCount: Object.keys(globalWorldBook).length,
      sourceCharacterId: characterId,
      sourceCharacterName,
    };

    // Save metadata in settings
    await WorldBookOperations.updateWorldBookSettings(globalId, {
      enabled: true,
      maxEntries: 50,
      contextWindow: 5,
      metadata,
    });

    return {
      success: true,
      message: `Global world book "${name}" created successfully with ${metadata.entryCount} entries`,
      globalId,
      worldBook: metadata,
    };
  } catch (error: any) {
    console.error("Failed to save as global world book:", error);
    return {
      success: false,
      message: `Failed to save as global world book: ${error.message}`,
    };
  }
}

export async function listGlobalWorldBooks(): Promise<ListGlobalWorldBooksResult> {
  try {
    const globalWorldBooks: GlobalWorldBook[] = [];

    const worldBooksData = await WorldBookOperations.getWorldBooks();
    
    for (const key of Object.keys(worldBooksData)) {
      if (key.startsWith("global_") && key.endsWith("_settings")) {
        const settings = worldBooksData[key] as WorldBookSettings;
        
        if (settings && settings.metadata) {
          globalWorldBooks.push(settings.metadata as GlobalWorldBook);
        }
      }
    }

    globalWorldBooks.sort((a, b) => b.createdAt - a.createdAt);

    return {
      success: true,
      globalWorldBooks,
    };
  } catch (error: any) {
    console.error("Failed to list global world books:", error);
    return {
      success: false,
      globalWorldBooks: [],
      message: `Failed to list global world books: ${error.message}`,
    };
  }
}

export async function getGlobalWorldBook(globalId: string): Promise<{
  success: boolean;
  worldBook?: Record<string, WorldBookEntry>;
  metadata?: GlobalWorldBook;
  message?: string;
}> {
  try {
    if (!globalId.startsWith("global_")) {
      return {
        success: false,
        message: "Invalid global world book ID",
      };
    }

    const worldBook = await WorldBookOperations.getWorldBook(globalId);
    const settings = await WorldBookOperations.getWorldBookSettings(globalId);

    if (!worldBook || !settings?.metadata) {
      return {
        success: false,
        message: "Global world book not found",
      };
    }

    return {
      success: true,
      worldBook,
      metadata: settings.metadata as GlobalWorldBook,
    };
  } catch (error: any) {
    console.error("Failed to get global world book:", error);
    return {
      success: false,
      message: `Failed to get global world book: ${error.message}`,
    };
  }
}

export async function importFromGlobalWorldBook(
  characterId: string,
  globalId: string,
): Promise<{
  success: boolean;
  message: string;
  importedCount: number;
}> {
  try {
    const globalResult = await getGlobalWorldBook(globalId);
    if (!globalResult.success || !globalResult.worldBook) {
      return {
        success: false,
        message: globalResult.message || "Failed to load global world book",
        importedCount: 0,
      };
    }

    const characterWorldBook = await WorldBookOperations.getWorldBook(characterId) || {};
    const now = Date.now();
    let importedCount = 0;

    for (const [entryId, entry] of Object.entries(globalResult.worldBook)) {
      const newEntryId = `entry_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      characterWorldBook[newEntryId] = {
        ...entry,
        extensions: {
          ...entry.extensions,
          imported: true,
          importedAt: now,
          globalSource: true,
          globalSourceId: globalId,
          globalSourceName: globalResult.metadata?.name,
        },
      };
      importedCount++;
    }

    const saveResult = await WorldBookOperations.updateWorldBook(characterId, characterWorldBook);
    if (!saveResult) {
      return {
        success: false,
        message: "Failed to save imported entries",
        importedCount: 0,
      };
    }

    return {
      success: true,
      message: `Successfully imported ${importedCount} entries from global world book "${globalResult.metadata?.name}"`,
      importedCount,
    };
  } catch (error: any) {
    console.error("Failed to import from global world book:", error);
    return {
      success: false,
      message: `Failed to import from global world book: ${error.message}`,
      importedCount: 0,
    };
  }
}

export async function deleteGlobalWorldBook(globalId: string): Promise<{
  success: boolean;
  message: string;
}> {
  try {
    if (!globalId.startsWith("global_")) {
      return {
        success: false,
        message: "Invalid global world book ID",
      };
    }

    await WorldBookOperations.updateWorldBook(globalId, {});
    
    await WorldBookOperations.updateWorldBookSettings(globalId, {
      enabled: false,
      contextWindow: 5,
      metadata: null,
    });

    return {
      success: true,
      message: "Global world book deleted successfully",
    };
  } catch (error: any) {
    console.error("Failed to delete global world book:", error);
    return {
      success: false,
      message: `Failed to delete global world book: ${error.message}`,
    };
  }
} 
