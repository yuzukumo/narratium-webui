import { PresetPrompt } from "@/lib/models/preset-model";
import { adaptText } from "@/lib/adapter/tagReplacer";
import {
  BASE_NARRATIVE_SYSTEM_PROMPT,
  NARRATIVE_CONTINUATION_GUIDE,
  OUTPUT_CONTRACT,
  RESPONSE_LANGUAGE_POLICY,
} from "@/lib/prompts/preset-prompts";
import type { Language } from "@/lib/i18n/languages";

interface PresetContextData {
  protagonistName?: string;
  charName?: string;
  number?: number;
  description?: string;
  personality?: string;
  scenario?: string;
  mesExamples?: string;
  creatorNotes?: string;
  systemPrompt?: string;
  postHistoryInstructions?: string;
}

export function responseLengthPreference(language: Language, target?: number): string {
  void language;
  const normalizedTarget = typeof target === "number" && Number.isFinite(target)
    ? Math.max(1, Math.round(target))
    : null;
  const length = normalizedTarget === null
    ? "a natural, moderate length"
    : `approximately ${normalizedTarget} characters`;
  return `This is a high-priority soft length preference: keep the main narrative body inside output near ${length}, normally within roughly 0.75x to 1.5x of the target. Do not substantially exceed it unless needed to finish an indivisible sentence, an ongoing exchange, or required output structure. This is not an API truncation limit: end naturally, never cut off a sentence or story beat, and do not pad the response to reach the target. Count only the main narrative body, excluding XML tags, next_prompts, and events.`;
}

export class PresetAssembler {
  static assemblePrompts(
    prompts: PresetPrompt[],
    language: Language = "zh",
    contextData: PresetContextData = {},
  ): { systemMessage: string; userMessage: string } {
    if (prompts.length === 0) {
      return PresetAssembler._getDefaultFramework(language, contextData);
    }

    const orderedSystemIdentifiers = [
      "main",
      "worldInfoBefore",
      "charDescription",
      "charPersonality",
      "scenario",
      "worldInfoAfter",
    ];

    const orderedUserIdentifiers = [
      "dialogueExamples",
      "enhanceDefinitions",
      "jailbreak",
      "chatHistory",
      "userInput",
    ];

    const systemSectionContents: { [key: string]: string[] } = {};
    orderedSystemIdentifiers.forEach(id => systemSectionContents[id] = []);

    const userSectionContents: { [key: string]: string[] } = {};
    orderedUserIdentifiers.forEach(id => userSectionContents[id] = []);

    let currentSystemSection: string | null = null;
    let currentUserSection: string | null = null;

    for (const prompt of prompts) {
      if (prompt.enabled === false) continue;

      const isSystemSection = orderedSystemIdentifiers.includes(prompt.identifier);
      const isUserSection = orderedUserIdentifiers.includes(prompt.identifier);

      const formattedContent = PresetAssembler._formatPromptContent(prompt, language, contextData);

      if (isSystemSection) {
        currentSystemSection = prompt.identifier;
        currentUserSection = null;
        if (formattedContent) {
          systemSectionContents[currentSystemSection].push(formattedContent);
        }
      } else if (isUserSection) {
        currentUserSection = prompt.identifier;
        currentSystemSection = null;
        if (formattedContent) {
          userSectionContents[currentUserSection].push(formattedContent);
        }
      } else {
        if (currentSystemSection) {
          if (formattedContent) {
            systemSectionContents[currentSystemSection].push(formattedContent);
          }
        } else if (currentUserSection) {
          if (formattedContent) {
            userSectionContents[currentUserSection].push(formattedContent);
          }
        }
      }
    }

    let finalSystemMessageParts: string[] = [];
    for (const id of orderedSystemIdentifiers) {
      const sectionContent = systemSectionContents[id].filter(Boolean).join("\n\n");
      
      finalSystemMessageParts.push(`<${id}>`);

      if (sectionContent) {
        finalSystemMessageParts.push(sectionContent);
      } else if (id === "worldInfoBefore" || id === "worldInfoAfter") {
        finalSystemMessageParts.push(`{{${id}}}`);
      }
      if (id === "main") {
        finalSystemMessageParts.push(RESPONSE_LANGUAGE_POLICY);
      }
      finalSystemMessageParts.push(`</${id}>`);
    }

    let finalUserMessageParts: string[] = [];
    let hasUserInputSection = false;
    
    for (const id of orderedUserIdentifiers) {
      const sectionContent = userSectionContents[id].filter(Boolean).join("\n\n");
      
      finalUserMessageParts.push(`<${id}>`);

      if (sectionContent) {
        finalUserMessageParts.push(sectionContent);
        if (id === "userInput") {
          hasUserInputSection = true;
        }
      } else if (id === "chatHistory") {
        finalUserMessageParts.push(`{{${id}}}`);
      } else if (id === "userInput") {
        finalUserMessageParts.push(`{{${id}}}`);
        hasUserInputSection = true;
      }
      finalUserMessageParts.push(`</${id}>`);
    }

    if (!hasUserInputSection) {
      finalUserMessageParts.push("<userInput>");
      finalUserMessageParts.push("{{userInput}}");
      finalUserMessageParts.push("</userInput>");
    }
    finalUserMessageParts.push("<outputFormat>");
    finalUserMessageParts.push(OUTPUT_CONTRACT);
    finalUserMessageParts.push("</outputFormat>");

    return {
      systemMessage: finalSystemMessageParts.filter(Boolean).join("\n\n"),
      userMessage: finalUserMessageParts.filter(Boolean).join("\n\n"),
    };
  }

  private static _getDefaultFramework(language: Language = "zh", contextData: PresetContextData = {}): { systemMessage: string; userMessage: string } {
    const orderedSystemIdentifiers = [
      "main",
      "worldInfoBefore",
      "charDescription",
      "charPersonality",
      "scenario",
      "worldInfoAfter",
    ];
  
    const orderedUserIdentifiers = [
      "dialogueExamples",
      "enhanceDefinitions",
      "jailbreak",
      "chatHistory",
      "userInput",
    ];
  
    let finalSystemMessageParts: string[] = [];
    for (const id of orderedSystemIdentifiers) {
      finalSystemMessageParts.push(`<${id}>`);

      if (id === "main") {
        finalSystemMessageParts.push(BASE_NARRATIVE_SYSTEM_PROMPT);
        finalSystemMessageParts.push(RESPONSE_LANGUAGE_POLICY);
      } else if (id === "worldInfoBefore" || id === "worldInfoAfter") {
        finalSystemMessageParts.push(`{{${id}}}`);
      }
  
      finalSystemMessageParts.push(`</${id}>`);
    }
  
    let finalUserMessageParts: string[] = [];
    let hasUserInputSection = false;
  
    for (const id of orderedUserIdentifiers) {
      finalUserMessageParts.push(`<${id}>`);
      
      if (id === "enhanceDefinitions") {
        finalUserMessageParts.push(NARRATIVE_CONTINUATION_GUIDE);
      } else if (id === "chatHistory" || id === "userInput") {
        finalUserMessageParts.push(`{{${id}}}`);
        if (id === "userInput") {
          hasUserInputSection = true;
        }
      }
  
      finalUserMessageParts.push(`</${id}>`);
    }
    if (!hasUserInputSection) {
      finalUserMessageParts.push("<userInput>");
      finalUserMessageParts.push("{{userInput}}");
      finalUserMessageParts.push("</userInput>");
    }
  
    finalUserMessageParts.push("");
    finalUserMessageParts.push("<outputFormat>");
    finalUserMessageParts.push(OUTPUT_CONTRACT);
    finalUserMessageParts.push("</outputFormat>");
    return {
      systemMessage: finalSystemMessageParts.filter(Boolean).join("\n\n"),
      userMessage: finalUserMessageParts.filter(Boolean).join("\n\n"),
    };
  }

  private static _formatPromptContent(
    prompt: PresetPrompt,
    language: Language,
    contextData: PresetContextData,
  ): string {
    let contentToAppend = "";

    const isAlwaysMarked = (prompt.identifier === "worldInfoBefore" || prompt.identifier === "worldInfoAfter" || prompt.identifier === "chatHistory" || prompt.identifier === "userInput");

    if (isAlwaysMarked) {
      contentToAppend += `{{${prompt.identifier}}}`;
    }

    if (prompt.content) {
      let adaptedPromptContent = adaptText(
        prompt.content,
        language,
        contextData.protagonistName,
        contextData.charName,
        contextData,
      );
      if (prompt.name) {
        adaptedPromptContent = `【${prompt.name}】\n${adaptedPromptContent}`;
      }

      if (contentToAppend) {
        contentToAppend += `\n\n${adaptedPromptContent}`;
      } else {
        contentToAppend = adaptedPromptContent;
      }
    }
    return contentToAppend;
  }
} 
