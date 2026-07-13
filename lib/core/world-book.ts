import { WorldBookEntry } from "@/lib/models/world-book-model";
import { DialogueMessage } from "@/lib/models/character-dialogue-model";

export interface WorldBookJson {
  entries: Record<string, WorldBookEntry> | WorldBookEntry[];
}

/** SillyTavern's persisted world-book position values. */
export const SILLY_TAVERN_WORLD_BOOK_POSITION = {
  beforeCharacter: 0,
  afterCharacter: 1,
  authorNoteTop: 2,
  authorNoteBottom: 3,
  atDepth: 4,
  examplesTop: 5,
  examplesBottom: 6,
  outlet: 7,
} as const;

export interface WorldBookScanSources {
  personaDescription?: string;
  characterDescription?: string;
  characterPersonality?: string;
  characterDepthPrompt?: string;
  scenario?: string;
  creatorNotes?: string;
}

export class WorldBookManager {
  private static regexFromString(value: string, allowRaw: boolean): RegExp | null {
    const match = value.match(/^\/([\s\S]*)\/([dgimsuvy]*)$/);
    if (!match && !allowRaw) return null;
    try {
      return match ? new RegExp(match[1], match[2]) : new RegExp(value, "u");
    } catch {
      return null;
    }
  }

  private static keyMatches(text: string, key: string, entry: WorldBookEntry): boolean {
    const normalizedKey = key.trim();
    if (!normalizedKey) return false;
    const expression = this.regexFromString(normalizedKey, entry.use_regex === true);
    if (expression) {
      expression.lastIndex = 0;
      return expression.test(text);
    }

    const caseSensitive = typeof entry.extensions?.case_sensitive === "boolean"
      ? entry.extensions.case_sensitive
      : entry.case_sensitive === true;
    const haystack = caseSensitive ? text : text.toLocaleLowerCase();
    const needle = caseSensitive ? normalizedKey : normalizedKey.toLocaleLowerCase();
    if (entry.extensions?.match_whole_words !== true) {
      return haystack.includes(needle);
    }
    if (needle.split(/\s+/).length > 1) {
      return haystack.includes(needle);
    }
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`, "u").test(haystack);
  }

  static getMatchingEntries(
    worldBook: WorldBookEntry[] | Record<string, WorldBookEntry> | undefined,
    message: string,
    chatHistory: DialogueMessage[],
    options: {
      contextWindow?: number;
      tokenBudget?: number;
      recursiveScanning?: boolean;
      scanSources?: WorldBookScanSources;
    } = {},
  ): WorldBookEntry[] {
    if (!worldBook) return [];
    
    const { contextWindow = 5, tokenBudget, recursiveScanning = false, scanSources = {} } = options;

    const entries = Array.isArray(worldBook) 
      ? worldBook 
      : Object.values(worldBook);

    const enabledEntries = entries.filter(entry => entry.enabled !== false);

    const selected = new Set<WorldBookEntry>(enabledEntries.filter((entry) => entry.constant));
    const scanText = (entry: WorldBookEntry): string => {
      const configuredDepth = Number(entry.extensions?.scan_depth ?? entry.extensions?.scanDepth);
      const depth = Number.isFinite(configuredDepth) && configuredDepth >= 0
        ? Math.trunc(configuredDepth)
        : contextWindow;
      // SillyTavern treats an explicit scan depth of zero as "current input
      // only". Array#slice(-0) would accidentally scan the entire history.
      const parts = (depth === 0 ? [] : chatHistory.slice(-depth)).map((item) => item.content);
      if (message) parts.push(message);
      if (entry.extensions?.match_persona_description === true) parts.push(scanSources.personaDescription || "");
      if (entry.extensions?.match_character_description === true) parts.push(scanSources.characterDescription || "");
      if (entry.extensions?.match_character_personality === true) parts.push(scanSources.characterPersonality || "");
      if (entry.extensions?.match_character_depth_prompt === true) parts.push(scanSources.characterDepthPrompt || "");
      if (entry.extensions?.match_scenario === true) parts.push(scanSources.scenario || "");
      if (entry.extensions?.match_creator_notes === true) parts.push(scanSources.creatorNotes || "");
      return parts.filter(Boolean).join(" ");
    };
    const matchesText = (entry: WorldBookEntry, value: string): boolean => {
      if (!entry.keys || entry.keys.length === 0) return false;
      const primaryMatch = entry.keys.some((key) => this.keyMatches(value, key, entry));
      if (!primaryMatch) return false;
      const secondary = entry.secondary_keys || [];
      if (!entry.selective || secondary.length === 0) return true;
      const matches = secondary.map((key) => this.keyMatches(value, key, entry));
      switch (entry.extensions?.selectiveLogic ?? 0) {
      case 1: return !matches.every(Boolean);
      case 2: return !matches.some(Boolean);
      case 3: return matches.every(Boolean);
      default: return matches.some(Boolean);
      }
    };
    const passesProbability = (entry: WorldBookEntry): boolean => {
      const probability = Math.min(Math.max(entry.extensions?.probability ?? 100, 0), 100);
      return entry.extensions?.useProbability === false
        || probability >= 100
        || Math.random() * 100 <= probability;
    };
    const activate = (value: string | null, recursion: boolean): WorldBookEntry[] => {
      const activated: WorldBookEntry[] = [];
      for (const entry of enabledEntries) {
        if (selected.has(entry) || entry.constant) continue;
        if (recursion && entry.extensions?.exclude_recursion === true) continue;
        const candidateText = value ?? scanText(entry);
        if (!matchesText(entry, candidateText) || !passesProbability(entry)) continue;
        selected.add(entry);
        activated.push(entry);
      }
      return activated;
    };

    let activated = [...selected, ...activate(null, false)];
    for (let depth = 0; recursiveScanning && activated.length > 0 && depth < 8; depth += 1) {
      const recursiveText = activated
        .filter((entry) => entry.extensions?.prevent_recursion !== true)
        .map((entry) => entry.content)
        .join("\n");
      if (!recursiveText) break;
      activated = activate(recursiveText, true);
    }

    const sorted = [...selected].sort(
      (a, b) => (a.insertion_order ?? 0) - (b.insertion_order ?? 0),
    );
    if (!tokenBudget || tokenBudget < 1) {
      return sorted;
    }

    let usedTokens = 0;
    return sorted.filter((entry) => {
      if (entry.extensions?.ignore_budget === true) return true;
      const entryTokens = this.estimateTokens(entry.content);
      if (usedTokens + entryTokens > tokenBudget) return false;
      usedTokens += entryTokens;
      return true;
    });
  }

  private static estimateTokens(value: string): number {
    let units = 0;
    for (const character of value) {
      units += character.codePointAt(0)! <= 0x7f ? 1 : 4;
    }
    return Math.ceil(units / 4) + 4;
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
    const positionGroups: Record<number, WorldBookEntry[]> = Object.fromEntries(
      Array.from({ length: 8 }, (_, position) => [position, [] as WorldBookEntry[]]),
    );

    for (const entry of entries) {
      const position = typeof entry.position === "number" 
        ? entry.position 
        : 4;
      
      if (position >= 0 && position <= 7) {
        positionGroups[position].push(entry);
      } else {
        positionGroups[SILLY_TAVERN_WORLD_BOOK_POSITION.atDepth].push(entry);
      }
    }

    for (const position in positionGroups) {
      positionGroups[Number(position)].sort((a, b) => {
        const insertionOrderDiff = (b.insertion_order || 0) - (a.insertion_order || 0);
        if (insertionOrderDiff !== 0) return insertionOrderDiff;
        return String(a.id ?? "").localeCompare(String(b.id ?? ""));
      });
    }
    
    return positionGroups;
  }
}
