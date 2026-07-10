import { Character } from "@/lib/core/character";
import { PromptAssembler } from "@/lib/core/prompt-assembler";
import { PromptType } from "@/lib/models/character-prompts-model";
import { getCharacterCompressorPromptZh, getCharacterCompressorPromptEn } from "@/lib/prompts/character-prompts";
import { CharacterHistory } from "@/lib/core/character-history";
import { DialogueOptions } from "@/lib/models/character-dialogue-model";
import { DEFAULT_RESPONSE_LENGTH, ApiProvider } from "@/utils/api-config";
import { invokeLLM } from "@/utils/llm-api";

export class CharacterDialogue {
  character: Character;
  history: CharacterHistory;
  llm: {
    modelName: string;
    apiKey: string;
    baseUrl: string;
    llmType: ApiProvider;
    temperature: number;
    reasoningEffort?: DialogueOptions["reasoningEffort"];
  } | null;
  language: "zh" | "en" = "zh";
  promptType: PromptType = PromptType.COMPANION;
  promptAssembler: PromptAssembler;

  constructor(character: Character) {
    this.character = character;
    this.history = new CharacterHistory(this.language);
    this.llm = null;
    this.promptAssembler = new PromptAssembler({ language: this.language });
  }

  async initialize(options?: DialogueOptions): Promise<void> {
    try {
      if (options?.language) {
        this.language = options.language;
        this.history = new CharacterHistory(options.language);
      }
      if (options?.promptType) {
        this.promptType = options.promptType;
      }

      this.promptAssembler = new PromptAssembler({
        language: this.language,
        contextWindow: options?.contextWindow || 5,
      });
      
      this.setupLLM(options);
    } catch (error) {
      console.error("Failed to initialize character dialogue:", error);
      throw new Error("Failed to initialize character dialogue");
    }
  }

  async getFirstMessage(): Promise<string[]> {
    const firstMessage = await this.character.getFirstMessage();
    return firstMessage;
  }

  setupLLM(options?: DialogueOptions): void {
    if (!options) {
      return;
    }
    const {
      modelName,
      apiKey,
      baseUrl,
      llmType = "openai",
      reasoningEffort,
      temperature = 0.7,
    } = options;

    const safeModel = modelName && modelName.trim() ? modelName.trim() : "";
    const safeApiKey = apiKey && apiKey.trim() ? apiKey.trim() : "";

    type LLMSettings = {
      temperature: number;
      maxTokens?: number;
      timeout?: number;
      maxRetries: number;
      topP?: number;
      frequencyPenalty?: number;
      presencePenalty?: number;
    };
    
    let llmSettings: LLMSettings = {
      temperature: temperature || 0.9,
      maxRetries: 2,
      topP: 0.7,
      frequencyPenalty: 0,
      presencePenalty: 0,
    };
    
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        const savedSettings = localStorage.getItem("llmSettings");
        if (savedSettings) {
          llmSettings = {
            temperature: 0.9,
            maxTokens: undefined,
            timeout: undefined,
            maxRetries: 2,
            topP: 0.7,
            frequencyPenalty: 0,
            presencePenalty: 0,
          };
        }
      }
    } catch (error) {
      console.warn("Failed to load LLM settings from localStorage, using defaults", error);
    }

    if (!safeModel || !safeApiKey) {
      throw new Error("OpenAI model or API key is missing.");
    }

    this.llm = {
      modelName: safeModel,
      apiKey: safeApiKey,
      baseUrl,
      llmType,
      temperature: llmSettings.temperature,
      reasoningEffort,
    };
  }
  
  async compressStory(userInput: string, story: string): Promise<string> {
    if (!this.llm) {
      throw new Error("LLM not initialized");
    }
    
    try {
      let userPrompt;
      if (this.language === "zh") {
        userPrompt = getCharacterCompressorPromptZh(userInput, story);
      } else {
        userPrompt = getCharacterCompressorPromptEn(userInput, story);
      }

      const compressedStory = await invokeLLM({
        provider: this.llm.llmType,
        baseUrl: this.llm.baseUrl,
        apiKey: this.llm.apiKey,
        model: this.llm.modelName,
        systemMessage: "",
        userMessage: userPrompt,
        maxTokens: DEFAULT_RESPONSE_LENGTH,
        temperature: this.llm.temperature,
        reasoningEffort: this.llm.reasoningEffort,
      });

      return compressedStory.text;
    } catch (error) {
      console.error("Error compressing story:", error);
      throw new Error(`Failed to compress story: ${error}`);
    }
  }
}
