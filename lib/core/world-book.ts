import { WorldBookEntry } from "@/lib/models/world-book-model";
import { DialogueMessage } from "@/lib/models/character-dialogue-model";

export interface WorldBookJson {
  entries: Record<string, WorldBookEntry> | WorldBookEntry[];
}

export class WorldBookManager {
  static getMatchingEntries(
    worldBook: WorldBookEntry[] | Record<string, WorldBookEntry> | undefined,
    message: string,
    chatHistory: DialogueMessage[],
    options: {
      contextWindow?: number;
    } = {},
  ): WorldBookEntry[] {
    if (!worldBook) return [];
    
    const { contextWindow = 5 } = options;

    const recentMessages = chatHistory
      .slice(-contextWindow)
      .map(m => m.content)
      .join(" ");
    
    const fullText = `${recentMessages} ${message}`.toLowerCase();

    const entries = Array.isArray(worldBook) 
      ? worldBook 
      : Object.values(worldBook);

    const enabledEntries = entries.filter(entry => entry.selective !== false);

    const constantEntries = enabledEntries.filter(entry => entry.constant);

    const matchedEntries = enabledEntries
      .filter(entry => {
        if (entry.constant) return false;
        if (!entry.keys || entry.keys.length === 0) return false;
        return entry.keys.some(key => fullText.includes(key.toLowerCase()));
      });

    return [...constantEntries, ...matchedEntries];
  }
  
  static normalizeWorldBookEntries(worldBook: any): WorldBookEntry[] {
    if (!worldBook) return [];
    
    if (Array.isArray(worldBook)) {
      return worldBook;
    }
    
    if (worldBook.entries) {
      if (Array.isArray(worldBook.entries)) {
        return worldBook.entries;
      } else {
        return Object.values(worldBook.entries);
      }
    }
    
    return Object.values(worldBook);
  }
  
  static organizeEntriesByPosition(
    entries: WorldBookEntry[],
  ): Record<number, WorldBookEntry[]> {
    const positionGroups: Record<number, WorldBookEntry[]> = {
      0: [],
      1: [],
      2: [],
      3: [],
      4: [],
    };

    for (const entry of entries) {
      const position = typeof entry.position === "number" 
        ? entry.position 
        : 4;
      
      if (position >= 0 && position <= 4) {
        positionGroups[position].push(entry);
      } else {
        positionGroups[4].push(entry);
      }
    }

    for (const position in positionGroups) {
      positionGroups[Number(position)].sort((a, b) => {
        const insertionOrderDiff = (b.insertion_order || 0) - (a.insertion_order || 0);
        if (insertionOrderDiff !== 0) return insertionOrderDiff;
        return (b.insertion_order || 0) - (a.insertion_order || 0);
      });
    }
    
    return positionGroups;
  }
}
