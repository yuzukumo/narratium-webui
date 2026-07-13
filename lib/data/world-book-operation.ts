import { inheritDataRevision, readData, writeData, WORLD_BOOK_FILE } from "@/lib/data/local-storage";
import { WorldBookEntry } from "@/lib/models/world-book-model";
import { normalizeWorldBookEntry } from "@/lib/character-card/normalize";

export interface WorldBookSettings {
  enabled: boolean;
  maxEntries: number;
  contextWindow: number;
  metadata?: any;
}

const DEFAULT_SETTINGS: WorldBookSettings = {
  enabled: true,
  maxEntries: 5,
  contextWindow: 5,
};

export class WorldBookOperations {
  static async getWorldBooks(): Promise<Record<string, any>> {
    const worldBooksArray = await readData(WORLD_BOOK_FILE);
    if (worldBooksArray[0]) {
      return worldBooksArray[0];
    }
    const emptyWorldBooks: Record<string, any> = {};
    inheritDataRevision(WORLD_BOOK_FILE, worldBooksArray, [emptyWorldBooks]);
    return emptyWorldBooks;
  }

  private static async saveWorldBooks(worldBooks: Record<string, any>): Promise<void> {
    await writeData(WORLD_BOOK_FILE, [worldBooks]);
  }

  static async getWorldBook(characterId: string): Promise<Record<string, WorldBookEntry> | null> {
    try {
      const worldBooks = await this.getWorldBooks();
      return worldBooks[characterId] as Record<string, WorldBookEntry> || null;
    } catch (error) {
      console.error("Error getting world book:", error);
      return null;
    }
  }
  
  static async updateWorldBook(
    characterId: string, 
    worldBook: Record<string, WorldBookEntry> | WorldBookEntry[],
  ): Promise<boolean> {
    const worldBooks = await this.getWorldBooks();
    
    const entries = Array.isArray(worldBook) 
      ? worldBook.reduce((acc, entry, i) => {
        const processedEntry = normalizeWorldBookEntry(entry, i);
        return {
          ...acc,
          [`entry_${i}`]: processedEntry,
        };
      }, {} as Record<string, WorldBookEntry>)
      : Object.fromEntries(
        Object.entries(worldBook).map(([key, entry]) => {
          const processedEntry = normalizeWorldBookEntry(entry);
          return [key, processedEntry];
        }),
      );
    
    worldBooks[characterId] = entries;
    await this.saveWorldBooks(worldBooks);
    return true;
  }

  static async deleteWorldBook(characterId: string): Promise<void> {
    const worldBooks = await this.getWorldBooks();
    delete worldBooks[characterId];
    delete worldBooks[`${characterId}_settings`];
    await this.saveWorldBooks(worldBooks);
  }
  
  static async addWorldBookEntry(
    characterId: string, 
    entry: WorldBookEntry,
  ): Promise<string | null> {
    const worldBook = await this.getWorldBook(characterId) || {};
    
    const entryId = `entry_${Object.keys(worldBook).length}`;

    worldBook[entryId] = entry;
    
    const success = await this.updateWorldBook(characterId, worldBook);
    
    return success ? entryId : null;
  }
  
  static async updateWorldBookEntry(
    characterId: string, 
    entryId: string, 
    updates: Partial<WorldBookEntry>,
  ): Promise<boolean> {
    const worldBook = await this.getWorldBook(characterId);
    
    if (!worldBook || !worldBook[entryId]) {
      return false;
    }
    
    worldBook[entryId] = { ...worldBook[entryId], ...updates };
    
    return this.updateWorldBook(characterId, worldBook);
  }
  
  static async deleteWorldBookEntry(characterId: string, entryId: string): Promise<boolean> {
    const worldBook = await this.getWorldBook(characterId);
    
    if (!worldBook || !worldBook[entryId]) {
      return false;
    }
    
    delete worldBook[entryId];
    
    return this.updateWorldBook(characterId, worldBook);
  }
  
  static async getWorldBookSettings(characterId: string): Promise<WorldBookSettings> {
    const worldBooks = await this.getWorldBooks();
    const settings = worldBooks[`${characterId}_settings`] as unknown as WorldBookSettings;
    
    if (!settings) {
      return { ...DEFAULT_SETTINGS };
    }
    
    return {
      ...DEFAULT_SETTINGS,
      ...settings,
    };
  }
  
  static async updateWorldBookSettings(
    characterId: string,
    updates: Partial<WorldBookSettings>,
  ): Promise<WorldBookSettings> {
    const worldBooks = await this.getWorldBooks();
    const currentSettings = {
      ...DEFAULT_SETTINGS,
      ...(worldBooks[`${characterId}_settings`] as WorldBookSettings | undefined),
    };
    const newSettings = { ...currentSettings, ...updates };
    
    worldBooks[`${characterId}_settings`] = newSettings;
    await this.saveWorldBooks(worldBooks);
    
    return newSettings;
  }
}
