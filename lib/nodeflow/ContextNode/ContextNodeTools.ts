import { NodeTool } from "@/lib/nodeflow/NodeTool";
import { LocalCharacterDialogueOperations } from "@/lib/data/character-dialogue-operation";
import { DialogueMessage } from "@/lib/models/character-dialogue-model";

export class DialogueStory {
  language: string;
  userInput: string[];
  responses: string[];

  constructor(language: string, userInput: string[] | null = null, responses: string[] | null = null) {
    this.language = language;
    this.userInput = userInput || [];
    this.responses = responses || [];
  }

  getStory(startIndex: number | null = null, endIndex: number | null = null): string {
    if (startIndex === null) startIndex = 0;
    if (endIndex === null) endIndex = this.responses.length;
  
    let result = "";
    const userLabel = "User";
    const assistantLabel = "Character";
  
    for (let i = startIndex; i < endIndex; i++) {
      const userInput = this.userInput[i];
      const response = this.responses[i];
  
      if (userInput) result += `${userLabel}: ${userInput}\n`;
      if (response) result += `${assistantLabel}: ${response}\n`;
    }
  
    return result.trim();
  }
}

export class ContextNodeTools extends NodeTool {
  protected static readonly toolType: string = "context";
  protected static readonly version: string = "1.0.0";

  static getToolType(): string {
    return this.toolType;
  }

  static async executeMethod(methodName: string, ...params: any[]): Promise<any> {
    const method = (this as any)[methodName];
    
    if (typeof method !== "function") {
      console.error(`Method lookup failed: ${methodName} not found in ContextNodeTools`);
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

  static async assembleChatHistory(
    userMessage: string,
    characterId: string,
    memoryLength: number = 10,
  ): Promise<{ userMessage: string; messages: DialogueMessage[] }> {
    try {
      if (!userMessage.includes("{{chatHistory}}")) {
        return { userMessage, messages: [] };
      }

      const historyData = await this.loadCharacterHistory(characterId);
      const chatHistoryContent = this.formatChatHistory(historyData, memoryLength);

      const assembledUserMessage = userMessage.replace("{{chatHistory}}", chatHistoryContent);

      console.log(`Assembled chat history for character ${characterId}`);

      return {
        userMessage: assembledUserMessage,
        messages: [],
      };
    } catch (error) {
      this.handleError(error as Error, "assembleChatHistory");
      return { userMessage, messages: [] };
    }
  }

  static async loadCharacterHistory(
    characterId: string,
  ): Promise<{
    systemMessage: string;
    recentDialogue: DialogueStory;
    historyDialogue: DialogueStory;
  }> {
    try {
      const recentDialogue = new DialogueStory("en");
      const historyDialogue = new DialogueStory("en");
      let systemMessage = "";

      const dialogueTree = await LocalCharacterDialogueOperations.getDialogueTreeById(characterId);
      if (!dialogueTree) {
        console.warn(`Dialogue tree not found for character ${characterId}`);
        return { systemMessage, recentDialogue, historyDialogue };
      }

      const nodePath = dialogueTree.current_node_id !== "root"
        ? await LocalCharacterDialogueOperations.getDialoguePathToNode(characterId, dialogueTree.current_node_id)
        : [];
      
      for (const node of nodePath) {
        if (node.parent_node_id === "root" && node.assistant_response) {
          systemMessage = node.assistant_response;
          continue;
        }
        if (node.user_input) {
          recentDialogue.userInput.push(node.user_input);
          historyDialogue.userInput.push(node.user_input);
        }
        if (node.assistant_response) {
          recentDialogue.responses.push(node.assistant_response);
          const compressedContent = node.parsed_content?.compressedContent || "";
          historyDialogue.responses.push(compressedContent);
        }
      }

      return { systemMessage, recentDialogue, historyDialogue };
    } catch (error) {
      this.handleError(error as Error, "loadCharacterHistory");
      return { 
        systemMessage: "", 
        recentDialogue: new DialogueStory("en"), 
        historyDialogue: new DialogueStory("en"),
      };
    }
  }

  static formatChatHistory(
    historyData: {
      systemMessage: string;
      recentDialogue: DialogueStory;
      historyDialogue: DialogueStory;
    },
    memoryLength: number,
  ): string {
    try {
      const parts: string[] = [];

      if (historyData.systemMessage) {
        parts.push(`开场白：${historyData.systemMessage}`);
      }

      const compressedHistory = this.getCompressedHistory(historyData.historyDialogue, memoryLength);
      if (compressedHistory) {
        parts.push(`历史信息：${compressedHistory}`);
      }

      const recentHistory = this.getRecentHistory(historyData.recentDialogue, memoryLength);
      if (recentHistory) {
        parts.push(`最近故事：${recentHistory}`);
      }

      return parts.filter(Boolean).join("\n\n");
    } catch (error) {
      this.handleError(error as Error, "formatChatHistory");
    }
  }

  static getRecentHistory(dialogue: DialogueStory, memLen: number): string {
    try {
      if (!dialogue) return "";
      
      const startIndex = Math.max(0, dialogue.userInput.length - memLen);
      return dialogue.getStory(startIndex);
    } catch (error) {
      this.handleError(error as Error, "getRecentHistory");
    }
  }

  static getCompressedHistory(dialogue: DialogueStory, memLen: number): string {
    try {
      if (!dialogue) return "";
      
      const endIndex = Math.max(0, dialogue.responses.length - memLen);
      return dialogue.getStory(0, endIndex);
    } catch (error) {
      this.handleError(error as Error, "getCompressedHistory");
    }
  }
} 

