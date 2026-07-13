import { NodeTool } from "@/lib/nodeflow/NodeTool";
import { PresetOperations } from "@/lib/data/preset-operation";
import { PresetAssembler } from "@/lib/core/preset-assembler";
import { LocalCharacterRecordOperations } from "@/lib/data/character-record-operation";
import { Character } from "@/lib/core/character";
import type { Language } from "@/lib/i18n/languages";
import { defaultProtagonistName } from "@/lib/i18n/languages";

export class PresetNodeTools extends NodeTool {
  protected static readonly toolType: string = "preset";
  protected static readonly version: string = "1.0.0";

  static getToolType(): string {
    return this.toolType;
  }

  static async executeMethod(methodName: string, ...params: any[]): Promise<any> {
    const method = (this as any)[methodName];
    
    if (typeof method !== "function") {
      console.error(`Method lookup failed: ${methodName} not found in PresetNodeTools`);
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

  static async buildPromptFramework(
    characterId: string,
    language: Language = "zh",
    charName?: string,
    number?: number,
  ): Promise<{ systemMessage: string; userMessage: string; presetId?: string; protagonistName: string; characterName: string }> {
    try {
      const characterRecord = await LocalCharacterRecordOperations.getCharacterById(characterId);
      const character = new Character(characterRecord);
      const protagonistName = character.protagonistName || defaultProtagonistName(language);
      const characterName = charName || character.characterData.name;
      const characterData = character.getData(language);
      
      const allPresets = await PresetOperations.getAllPresets();
      const enabledPreset = allPresets.find(preset => preset.enabled === true);
      
      let orderedPrompts: any[] = [];
      let presetId: string | undefined = undefined;
      
      if (enabledPreset && enabledPreset.id) {
        orderedPrompts = await PresetOperations.getOrderedPrompts(enabledPreset.id);
        presetId = enabledPreset.id;
      } else {
        console.log(`No enabled preset found, using default framework for character ${characterId}`);
      }
      
      const enrichedPrompts = this.enrichPromptsWithCharacterInfo(orderedPrompts, character);
      
      const assembled = PresetAssembler.assemblePrompts(
        enrichedPrompts,
        language,
        {
          protagonistName,
          charName: characterName,
          number,
          description: characterData.description,
          personality: characterData.personality,
          scenario: characterData.scenario,
          mesExamples: characterData.mes_example,
          creatorNotes: characterData.creatorcomment || characterData.creator_notes,
          systemPrompt: characterData.system_prompt,
          postHistoryInstructions: characterData.post_history_instructions,
        },
      );
      const { systemMessage, userMessage } = this.injectCharacterCardPrompts(
        assembled.systemMessage,
        assembled.userMessage,
        characterData,
      );

      return { 
        systemMessage: systemMessage, 
        userMessage: userMessage,
        presetId: presetId,
        protagonistName,
        characterName,
      };
    } catch (error) {
      this.handleError(error as Error, "buildPromptFramework");
    }
  }

  static injectCharacterCardPrompts(
    systemMessage: string,
    userMessage: string,
    data: Character["characterData"],
  ): { systemMessage: string; userMessage: string } {
    const appendSection = (value: string, section: string, content: string) => {
      if (!content.trim()) return value;
      if (value.includes(content.trim())) return value;
      const closingTag = `</${section}>`;
      return value.replace(closingTag, `${content.trim()}\n${closingTag}`);
    };

    let nextSystem = appendSection(systemMessage, "main", data.system_prompt);
    nextSystem = appendSection(nextSystem, "charDescription", data.description);
    nextSystem = appendSection(nextSystem, "charPersonality", data.personality);
    nextSystem = appendSection(nextSystem, "scenario", data.scenario);

    let nextUser = appendSection(userMessage, "dialogueExamples", data.mes_example);
    if (data.depth_prompt?.prompt.trim()) {
      const depthPrompt = [
        `<characterDepthPrompt role="${data.depth_prompt.role}" depth="${data.depth_prompt.depth}">`,
        data.depth_prompt.prompt.trim(),
        "</characterDepthPrompt>",
      ].join("\n");
      nextUser = appendSection(nextUser, "chatHistory", depthPrompt);
    }
    if (data.post_history_instructions.trim()) {
      const postHistoryInstructions = [
        "<postHistoryInstructions>",
        data.post_history_instructions.trim(),
        "</postHistoryInstructions>",
      ].join("\n");
      nextUser = nextUser.replace(
        "<userInput>",
        `${postHistoryInstructions}\n\n<userInput>`,
      );
    }
    return { systemMessage: nextSystem, userMessage: nextUser };
  }

  private static enrichPromptsWithCharacterInfo(
    prompts: any[],
    character: Character,
  ): any[] {
    return prompts.map(prompt => {
      const enrichedPrompt = { ...prompt };
      
      switch (prompt.identifier) {
      case "charDescription":
        if (!enrichedPrompt.content && character.characterData.description) {
          enrichedPrompt.content = character.characterData.description;
        }
        break;
          
      case "charPersonality":
        if (!enrichedPrompt.content && character.characterData.personality) {
          enrichedPrompt.content = character.characterData.personality;
        }
        break;
          
      case "scenario":
        if (!enrichedPrompt.content && character.characterData.scenario) {
          enrichedPrompt.content = character.characterData.scenario;
        }
        break;
      }
      
      return enrichedPrompt;
    });
  }
} 
