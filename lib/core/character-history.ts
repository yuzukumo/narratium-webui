import { DialogueMessage } from "@/lib/models/character-dialogue-model";

class DialogueStory {
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

export class CharacterHistory {
  language: string;
  systemMessage: string;
  memLen: number;
  recentDialogue: DialogueStory;
  historyDialogue: DialogueStory;

  constructor(language: string, systemMessage: string = "", memLen: number = 10) {
    this.language = language;
    this.systemMessage = systemMessage;
    this.memLen = memLen;
    this.recentDialogue = new DialogueStory(language);
    this.historyDialogue = new DialogueStory(language);
  }

  getRecentHistory(): string {
    return this.recentDialogue.getStory(this.recentDialogue.userInput.length - this.memLen, this.recentDialogue.responses.length);
  }

  getCompressedHistory(): string {
    return this.historyDialogue.getStory(0, this.historyDialogue.responses.length - this.memLen);
  }

  getSystemMessage(): string {
    return this.systemMessage;
  }

  getMessages(): DialogueMessage[] {
    const messages: DialogueMessage[] = [];
    
    const length = Math.min(this.recentDialogue.userInput.length, this.recentDialogue.responses.length);
    for (let i = 0; i < length; i++) {
      if (this.recentDialogue.userInput[i]) {
        messages.push({
          role: "user",
          content: this.recentDialogue.userInput[i],
          id: i * 2,
        });
      }

      if (this.recentDialogue.responses[i]) {
        messages.push({
          role: "assistant",
          content: this.recentDialogue.responses[i],
          id: i * 2 + 1,
        });
      }
    }
    
    if (this.recentDialogue.userInput.length > this.recentDialogue.responses.length) {
      const lastUserIndex = this.recentDialogue.userInput.length - 1;
      messages.push({
        role: "user",
        content: this.recentDialogue.userInput[lastUserIndex],
        id: messages.length,
      });
    }
    
    return messages;
  }
}
