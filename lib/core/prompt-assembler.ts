import { WorldBookEntry } from "@/lib/models/world-book-model";
import {
  SILLY_TAVERN_WORLD_BOOK_POSITION,
  WorldBookManager,
  type WorldBookScanSources,
} from "@/lib/core/world-book";
import { DialogueMessage } from "@/lib/models/character-dialogue-model";
import { adaptText } from "@/lib/adapter/tagReplacer";
import type { Language } from "@/lib/i18n/languages";

export interface PromptAssemblerOptions {
  language: Language;
  contextWindow?: number;
  worldBookTokenBudget?: number;
  recursiveWorldBookScanning?: boolean;
  scanSources?: WorldBookScanSources;
}

export class PromptAssembler {
  private language: Language;
  private contextWindow: number;
  private worldBookTokenBudget?: number;
  private recursiveWorldBookScanning: boolean;
  private scanSources: WorldBookScanSources;
  
  constructor(options: PromptAssemblerOptions) {
    this.language = options.language || "zh";
    this.contextWindow = options.contextWindow ?? 5;
    this.worldBookTokenBudget = options.worldBookTokenBudget;
    this.recursiveWorldBookScanning = options.recursiveWorldBookScanning === true;
    this.scanSources = options.scanSources || {};
  }

  assemblePrompt(
    worldBook: WorldBookEntry[] | Record<string, WorldBookEntry> | undefined,
    baseSystemMessage: string,
    userMessage: string,
    chatHistory: DialogueMessage[],
    currentUserInput: string,
    protagonistName?: string,
    charName?: string,
  ): { systemMessage: string; userMessage: string } {
    
    let finalSystemMessage = baseSystemMessage;
    let finalUserMessage = userMessage;

    if (finalUserMessage.includes("{{userInput}}")) {
      finalUserMessage = finalUserMessage.replace("{{userInput}}", currentUserInput);
    }

    if (!worldBook || (Array.isArray(worldBook) ? worldBook.length === 0 : Object.keys(worldBook).length === 0)) {
      return {
        systemMessage: this.clearWorldBookMarkers(finalSystemMessage),
        userMessage: this.clearOutletMarkers(finalUserMessage),
      };
    }

    const adjustedChatHistory = this.adjustChatHistoryByTurns(chatHistory);

    const matchingEntries = WorldBookManager.getMatchingEntries(
      worldBook,
      currentUserInput,
      adjustedChatHistory,
      {
        contextWindow: this.contextWindow,
        tokenBudget: this.worldBookTokenBudget,
        recursiveScanning: this.recursiveWorldBookScanning,
        scanSources: this.scanSources,
      },
    );

    if (matchingEntries.length === 0) {
      return {
        systemMessage: this.clearWorldBookMarkers(finalSystemMessage),
        userMessage: this.clearOutletMarkers(finalUserMessage),
      };
    }

    const positions = WorldBookManager.organizeEntriesByPosition(matchingEntries);
    const beforeCharacter = this.formatWorldBookEntries(
      positions[SILLY_TAVERN_WORLD_BOOK_POSITION.beforeCharacter], protagonistName, charName,
    );
    const afterCharacter = this.formatWorldBookEntries(
      positions[SILLY_TAVERN_WORLD_BOOK_POSITION.afterCharacter], protagonistName, charName,
    );
    finalSystemMessage = this.injectSystemWorldBook(finalSystemMessage, "worldInfoBefore", beforeCharacter, "before");
    finalSystemMessage = this.injectSystemWorldBook(finalSystemMessage, "worldInfoAfter", afterCharacter, "after");

    const authorNoteTop = this.formatWorldBookEntries(
      positions[SILLY_TAVERN_WORLD_BOOK_POSITION.authorNoteTop], protagonistName, charName,
    );
    const authorNoteBottom = this.formatWorldBookEntries(
      positions[SILLY_TAVERN_WORLD_BOOK_POSITION.authorNoteBottom], protagonistName, charName,
    );
    finalUserMessage = this.injectAuthorNoteWorldBook(finalUserMessage, authorNoteTop, authorNoteBottom);
    finalUserMessage = this.injectDepthWorldBook(
      finalUserMessage,
      positions[SILLY_TAVERN_WORLD_BOOK_POSITION.atDepth],
      protagonistName,
      charName,
    );

    const examplesTop = this.formatWorldBookEntries(
      positions[SILLY_TAVERN_WORLD_BOOK_POSITION.examplesTop], protagonistName, charName,
    );
    const examplesBottom = this.formatWorldBookEntries(
      positions[SILLY_TAVERN_WORLD_BOOK_POSITION.examplesBottom], protagonistName, charName,
    );
    finalUserMessage = this.injectInsideSection(finalUserMessage, "dialogueExamples", examplesTop, examplesBottom);

    const outlets = this.outletContents(
      positions[SILLY_TAVERN_WORLD_BOOK_POSITION.outlet],
      protagonistName,
      charName,
    );
    finalSystemMessage = this.replaceOutletMarkers(finalSystemMessage, outlets);
    finalUserMessage = this.replaceOutletMarkers(finalUserMessage, outlets);
    return { systemMessage: finalSystemMessage, userMessage: finalUserMessage };
  }

  private clearWorldBookMarkers(value: string): string {
    return this.clearOutletMarkers(value)
      .replaceAll("{{worldInfoBefore}}", "")
      .replaceAll("{{worldInfoAfter}}", "");
  }

  private clearOutletMarkers(value: string): string {
    return this.replaceOutletMarkers(value, new Map());
  }

  private injectSystemWorldBook(
    value: string,
    marker: "worldInfoBefore" | "worldInfoAfter",
    content: string,
    fallback: "before" | "after",
  ): string {
    const token = `{{${marker}}}`;
    if (value.includes(token)) return value.replaceAll(token, content);
    if (!content) return value;
    return fallback === "before" ? `${content}\n\n${value}` : `${value}\n\n${content}`;
  }

  private injectAuthorNoteWorldBook(value: string, top: string, bottom: string): string {
    if (!top && !bottom) return value;
    const opening = "<postHistoryInstructions>";
    const closing = "</postHistoryInstructions>";
    if (value.includes(opening) && value.includes(closing)) {
      return value
        .replace(opening, `${top ? `${top}\n\n` : ""}${opening}`)
        .replace(closing, `${closing}${bottom ? `\n\n${bottom}` : ""}`);
    }
    const section = ["<authorNote>", top, bottom, "</authorNote>"].filter(Boolean).join("\n\n");
    return value.includes("<userInput>")
      ? value.replace("<userInput>", `${section}\n\n<userInput>`)
      : `${value}\n\n${section}`;
  }

  private injectInsideSection(value: string, section: string, top: string, bottom: string): string {
    if (!top && !bottom) return value;
    const opening = `<${section}>`;
    const closing = `</${section}>`;
    if (value.includes(opening) && value.includes(closing)) {
      return value
        .replace(opening, `${opening}${top ? `\n${top}` : ""}`)
        .replace(closing, `${bottom ? `${bottom}\n` : ""}${closing}`);
    }
    const content = [top, bottom].filter(Boolean).join("\n\n");
    return value.includes("<userInput>")
      ? value.replace("<userInput>", `<${section}>\n${content}\n</${section}>\n\n<userInput>`)
      : `${value}\n\n<${section}>\n${content}\n</${section}>`;
  }

  private injectDepthWorldBook(
    value: string,
    entries: WorldBookEntry[],
    protagonistName?: string,
    charName?: string,
  ): string {
    if (entries.length === 0) return value;
    const opening = "<chatHistory>";
    const closing = "</chatHistory>";
    const openingIndex = value.indexOf(opening);
    const closingIndex = value.indexOf(closing, openingIndex + opening.length);
    if (openingIndex < 0 || closingIndex < 0) {
      const fallback = this.formatWorldBookEntries(entries, protagonistName, charName);
      return value.includes("<userInput>")
        ? value.replace("<userInput>", `${fallback}\n\n<userInput>`)
        : `${value}\n\n${fallback}`;
    }

    let history = value.slice(openingIndex + opening.length, closingIndex);
    const grouped = new Map<string, WorldBookEntry[]>();
    for (const entry of entries) {
      const depth = Math.max(0, Math.trunc(Number(entry.depth ?? entry.extensions?.depth ?? 4) || 0));
      const role = this.depthRole(entry);
      const key = `${depth}:${role}`;
      grouped.set(key, [...(grouped.get(key) || []), entry]);
    }
    const groups = [...grouped.entries()].sort(([left], [right]) => {
      const leftDepth = Number(left.split(":", 1)[0]);
      const rightDepth = Number(right.split(":", 1)[0]);
      return rightDepth - leftDepth;
    });
    for (const [key, depthEntries] of groups) {
      const [rawDepth, role] = key.split(":");
      const depth = Number(rawDepth);
      const content = this.formatWorldBookEntries(depthEntries, protagonistName, charName);
      const block = `<worldInformationAtDepth depth="${depth}" role="${role}">\n${content}\n</worldInformationAtDepth>`;
      history = this.insertIntoRenderedHistory(history, block, depth);
    }
    return `${value.slice(0, openingIndex + opening.length)}${history}${value.slice(closingIndex)}`;
  }

  private insertIntoRenderedHistory(history: string, block: string, depth: number): string {
    const turnMarkers = [...history.matchAll(/^\[TURN\s+\d+\]/gm)].map((match) => match.index ?? 0);
    if (depth <= 0 || turnMarkers.length === 0) {
      return `${history.trimEnd()}\n\n${block}\n`;
    }
    const turnsFromEnd = Math.max(1, Math.ceil(depth / 2));
    const targetTurn = Math.max(0, turnMarkers.length - turnsFromEnd);
    const insertionIndex = turnMarkers[targetTurn];
    return `${history.slice(0, insertionIndex).trimEnd()}\n\n${block}\n\n${history.slice(insertionIndex).trimStart()}`;
  }

  private depthRole(entry: WorldBookEntry): "system" | "user" | "assistant" {
    const directRole = (entry as WorldBookEntry & { role?: unknown }).role;
    const configured = directRole ?? entry.extensions?.role ?? 0;
    if (configured === 1 || configured === "user") return "user";
    if (configured === 2 || configured === "assistant") return "assistant";
    return "system";
  }

  private outletContents(
    entries: WorldBookEntry[],
    protagonistName?: string,
    charName?: string,
  ): Map<string, string> {
    const grouped = new Map<string, WorldBookEntry[]>();
    for (const entry of entries) {
      const name = (entry.outletName || entry.extensions?.outlet_name || "").trim();
      if (!name) continue;
      grouped.set(name, [...(grouped.get(name) || []), entry]);
    }
    return new Map([...grouped.entries()].map(([name, outletEntries]) => [
      name,
      this.formatWorldBookEntries(outletEntries, protagonistName, charName),
    ]));
  }

  private replaceOutletMarkers(value: string, outlets: Map<string, string>): string {
    return value.replace(/{{\s*outlet::([^{}]+)}}/gi, (_match, rawName: string) => (
      outlets.get(rawName.trim()) || ""
    ));
  }

  private formatWorldBookEntries(
    entries: WorldBookEntry[],
    protagonistName?: string,
    charName?: string,
  ): string {
    if (entries.length === 0) return "";
    
    return entries.map(entry => {
      const tagName = entry.comment || "worldbook_entry";
      let content = entry.content || "";
      content = adaptText(content, this.language, protagonistName, charName, {
        description: this.scanSources.characterDescription,
        personality: this.scanSources.characterPersonality,
        scenario: this.scanSources.scenario,
        creatorNotes: this.scanSources.creatorNotes,
      });
      
      return [
        "<worldInformation>",
        `<tag>${tagName}</tag>`,
        "<content>",
        content,
        "</content>",
        "</worldInformation>",
      ].join("\n");
    }).join("\n\n");
  }
  
  private adjustChatHistoryByTurns(chatHistory: DialogueMessage[]): DialogueMessage[] {
    if (chatHistory.length === 0) {
      return [];
    }
    
    const adjustedHistory: DialogueMessage[] = [];
    const conversationTurns: { user: DialogueMessage, assistant?: DialogueMessage }[] = [];
    
    let currentTurn: { user?: DialogueMessage, assistant?: DialogueMessage } = {};
    
    for (const message of chatHistory) {
      if (message.role === "user") {
        if (currentTurn.user) {
          conversationTurns.push(currentTurn as { user: DialogueMessage, assistant?: DialogueMessage });
          currentTurn = { user: message };
        } else {
          currentTurn.user = message;
        }
      } else if (message.role === "assistant") {
        if (currentTurn.user) {
          currentTurn.assistant = message;
          conversationTurns.push(currentTurn as { user: DialogueMessage, assistant?: DialogueMessage });
          currentTurn = {};
        }
      }
    }
    
    if (currentTurn.user) {
      conversationTurns.push(currentTurn as { user: DialogueMessage, assistant?: DialogueMessage });
    }
    
    const recentTurns = conversationTurns.slice(-this.contextWindow);
    
    for (const turn of recentTurns) {
      adjustedHistory.push(turn.user);
      if (turn.assistant) {
        adjustedHistory.push(turn.assistant);
      }
    }
    
    return adjustedHistory;
  }
}
