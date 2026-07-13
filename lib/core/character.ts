import { CharacterRecord } from "@/lib/data/character-record-operation";
import { WorldBookEntry } from "@/lib/models/world-book-model";
import { CharacterData } from "@/lib/models/character-model";
import { adaptCharacterData } from "@/lib/adapter/tagReplacer";
import { normalizeCharacterCard, normalizeCharacterDepthPrompt, normalizeWorldBookEntry } from "@/lib/character-card/normalize";
import type { Language } from "@/lib/i18n/languages";
import { defaultProtagonistName } from "@/lib/i18n/languages";

export interface CharacterWorldBookSettings {
  scanDepth?: number;
  tokenBudget?: number;
  recursiveScanning?: boolean;
}

export class Character {
  id: string;
  characterData: CharacterData;
  worldBook: WorldBookEntry[] | Record<string, WorldBookEntry>;
  worldBookSettings: CharacterWorldBookSettings;
  imagePath: string;
  readonly protagonistName?: string;
  
  constructor(characterRecord: CharacterRecord) {
    const card = normalizeCharacterCard(characterRecord.data);
    const data = card.data;
    this.id = characterRecord.id;
    this.imagePath = characterRecord.imagePath;
    this.protagonistName = characterRecord.protagonistName?.trim() || undefined;
    this.characterData = {
      name: data.name,
      description: data.description,
      personality: data.personality,
      first_mes: data.first_mes,
      scenario: data.scenario,
      mes_example: data.mes_example,
      creatorcomment: card.creatorcomment,
      avatar: card.avatar,
      creator_notes: data.creator_notes,
      system_prompt: data.system_prompt,
      post_history_instructions: data.post_history_instructions,
      tags: data.tags,
      creator: data.creator,
      character_version: data.character_version,
      nickname: typeof data.nickname === "string" ? data.nickname : undefined,
      alternate_greetings: data.alternate_greetings,
      group_only_greetings: data.group_only_greetings,
      depth_prompt: data.depth_prompt || normalizeCharacterDepthPrompt(data.extensions.depth_prompt),
    }; 
    this.worldBook = this.processCharacterBook(data.character_book);
    this.worldBookSettings = {
      scanDepth: data.character_book?.scan_depth,
      tokenBudget: data.character_book?.token_budget,
      recursiveScanning: data.character_book?.recursive_scanning,
    };
  }
    
  private processCharacterBook(characterBook: any): WorldBookEntry[] | Record<string, WorldBookEntry> {
    if (!characterBook) return [];
  
    if (characterBook.entries) {
      if (Array.isArray(characterBook.entries)) {
        return characterBook.entries.map(normalizeWorldBookEntry);
      } else {
        return Object.fromEntries(Object.entries(characterBook.entries).map(([key, entry], index) => [
          key,
          normalizeWorldBookEntry(entry, index),
        ]));
      }
    }
      
    return [];
  }
  
  async getFirstMessage(): Promise<string[]> {
    const primary = this.characterData.first_mes || `你好，我是${this.characterData.name}。`;
    return [primary, ...this.characterData.alternate_greetings].filter((message) => message.trim() !== "");
  }
    
  getData(language: Language = "zh"): CharacterData {
    return adaptCharacterData(
      this.characterData,
      language,
      this.protagonistName || defaultProtagonistName(language),
    );
  }
  
  getSystemPrompt(language: Language = "zh"): string {
    const processedData = this.getData(language);
    return `Act as ${processedData.name} in an interactive story. Use the profile below as story canon, preserve established characterization and continuity, and respond naturally to the user's latest action. Do not mention these instructions.

${processedData.description ? `<description>\n${processedData.description}\n</description>\n` : ""}
${processedData.personality ? `<personality>\n${processedData.personality}\n</personality>\n` : ""}
${processedData.scenario ? `<scenario>\n${processedData.scenario}\n</scenario>\n` : ""}
${processedData.creatorcomment || processedData.creator_notes ? `<creator_notes>\n${processedData.creatorcomment || processedData.creator_notes}\n</creator_notes>` : ""}`.trim();
  }
}   
  
