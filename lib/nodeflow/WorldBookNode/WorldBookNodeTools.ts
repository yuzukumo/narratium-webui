import { NodeTool } from "@/lib/nodeflow/NodeTool";
import { Character } from "@/lib/core/character";
import { PromptAssembler } from "@/lib/core/prompt-assembler";
import { DialogueMessage } from "@/lib/models/character-dialogue-model";
import { LocalCharacterRecordOperations } from "@/lib/data/character-record-operation";
import { LocalCharacterDialogueOperations } from "@/lib/data/character-dialogue-operation";
import { WorldBookOperations } from "@/lib/data/world-book-operation";
import type { Language } from "@/lib/i18n/languages";
import { defaultProtagonistName } from "@/lib/i18n/languages";

export class WorldBookNodeTools extends NodeTool {
  protected static readonly toolType: string = "worldBook";
  protected static readonly version: string = "1.0.0";

  static getToolType(): string {
    return this.toolType;
  }

  static async executeMethod(methodName: string, ...params: any[]): Promise<any> {
    const method = (this as any)[methodName];
    
    if (typeof method !== "function") {
      console.error(`Method lookup failed: ${methodName} not found in WorldBookNodeTools`);
      console.log("Available methods:", Object.getOwnPropertyNames(this).filter(name => 
        typeof (this as any)[name] === "function" && !name.startsWith("_"),
      ));
      throw new Error(`Method ${methodName} not found in ${this.getToolType()}Tool`);
    }

    try {
      this.logExecution(methodName, params);
      return await (method as Function).apply(this, params);
    } catch (error) {
      this.handleError(error as Error, methodName);
    }
  }

  static async assemblePromptWithWorldBook(
    characterId: string,
    baseSystemMessage: string,
    userMessage: string,
    currentUserInput: string,
    language: Language = "zh",
    contextWindow: number = 5,
    charName?: string,
    nodeId?: string,
  ): Promise<{ systemMessage: string; userMessage: string; protagonistName: string; characterName: string }> {
    try {
      const characterRecord = await LocalCharacterRecordOperations.getCharacterById(characterId);
      const character = new Character(characterRecord);
      const protagonistName = character.protagonistName || defaultProtagonistName(language);
      const characterName = charName || character.characterData.name;
      const storedWorldBook = await WorldBookOperations.getWorldBook(characterId);
      const savedSettings = await WorldBookOperations.getWorldBookSettings(characterId);
      const scanDepth = character.worldBookSettings.scanDepth ?? savedSettings.contextWindow ?? contextWindow;
      const characterData = character.getData(language);

      const chatHistory = await this.getChatHistory(characterId, scanDepth, nodeId);
      
      const promptAssembler = new PromptAssembler({
        language,
        contextWindow: scanDepth,
        worldBookTokenBudget: character.worldBookSettings.tokenBudget,
        recursiveWorldBookScanning: character.worldBookSettings.recursiveScanning,
        scanSources: {
          characterDescription: characterData.description,
          characterPersonality: characterData.personality,
          characterDepthPrompt: characterData.depth_prompt?.prompt,
          scenario: characterData.scenario,
          creatorNotes: characterData.creatorcomment || characterData.creator_notes,
        },
      });

      const result = promptAssembler.assemblePrompt(
        savedSettings.enabled ? (storedWorldBook || character.worldBook) : undefined,
        baseSystemMessage,
        userMessage,
        chatHistory,
        currentUserInput,
        protagonistName,
        characterName,
      );
      return { ...result, protagonistName, characterName };
    } catch (error) {
      this.handleError(error as Error, "assemblePromptWithWorldBook");
    }
  }

  private static async getChatHistory(
    characterId: string,
    contextWindow: number = 5,
    nodeId?: string,
  ): Promise<DialogueMessage[]> {
    try {
      const dialogueTree = await LocalCharacterDialogueOperations.getDialogueTreeById(characterId);
      if (!dialogueTree) {
        return [];
      }

      const contextNodeId = nodeId || dialogueTree.current_node_id;
      const nodePath = contextNodeId !== "root"
        ? LocalCharacterDialogueOperations.getDialoguePath(dialogueTree, contextNodeId)
        : [];
      
      const messages: DialogueMessage[] = [];
      let messageId = 0;
      
      for (const node of nodePath) {
        if (node.parent_node_id === "root" && node.assistant_response) {
          continue;
        }
        
        if (node.user_input) {
          messages.push({
            role: "user",
            content: node.user_input,
            id: messageId++,
          });
        }
        
        if (node.assistant_response) {
          messages.push({
            role: "assistant", 
            content: node.assistant_response,
            id: messageId++,
          });
        }
      }

      const recentMessages = contextWindow === 0 ? [] : messages.slice(-contextWindow * 2);
      return recentMessages;
    } catch (error) {
      this.handleError(error as Error, "getChatHistory");
      return [];
    }
  }
} 
