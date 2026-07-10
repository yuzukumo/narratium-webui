import { readData, writeData, WORLD_BOOK_FILE } from "@/lib/data/local-storage";
import { WorldBookEntry } from "@/lib/models/world-book-model";

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
    return worldBooksArray[0] || {};
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
    
    const processEntry = (entry: WorldBookEntry): WorldBookEntry => {
      return {
        ...entry,
        depth: entry.extensions?.depth ?? 1,
        position: entry.extensions?.position ?? 4,
      } as WorldBookEntry;
    };
    
    const entries = Array.isArray(worldBook) 
      ? worldBook.reduce((acc, entry, i) => {
        const processedEntry = processEntry(entry);
        return {
          ...acc,
          [`entry_${i}`]: processedEntry,
        };
      }, {} as Record<string, WorldBookEntry>)
      : Object.fromEntries(
        Object.entries(worldBook).map(([key, entry]) => {
          const processedEntry = processEntry(entry);
          return [key, processedEntry];
        }),
      );
    
    worldBooks[characterId] = entries;
    await this.saveWorldBooks(worldBooks);
    return true;
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
    const currentSettings = await this.getWorldBookSettings(characterId);
    const newSettings = { ...currentSettings, ...updates };
    
    worldBooks[`${characterId}_settings`] = newSettings;
    await this.saveWorldBooks(worldBooks);
    
    return newSettings;
  }
}
