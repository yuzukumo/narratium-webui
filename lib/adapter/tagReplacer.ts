import type { Language } from "@/lib/i18n/languages";
import { defaultProtagonistName } from "@/lib/i18n/languages";

export interface MacroContext {
  description?: string;
  personality?: string;
  scenario?: string;
  mesExamples?: string;
  creatorNotes?: string;
  systemPrompt?: string;
  postHistoryInstructions?: string;
  lastMessage?: string;
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function expandStableChoiceMacros(value: string, seed: string): string {
  return value.replace(
    /{{\s*(random|pick)\s*(?:::|\s)([^{}]+)}}/gi,
    (match, _name: string, rawOptions: string) => {
      const separator = rawOptions.includes("::") ? "::" : ",";
      const options = rawOptions.split(separator).map((item) => item.trim()).filter(Boolean);
      if (options.length === 0) return match;
      return options[stableHash(`${seed}:${match}`) % options.length];
    },
  );
}

export function adaptText(
  text: string,
  language: Language,
  protagonistName?: string,
  charName?: string,
  context: MacroContext = {},
): string {
  let parsed = text.replace(/<br\s*\/?>/gi, "\n");
  const userReplacement = protagonistName?.trim() || defaultProtagonistName(language);
  parsed = expandStableChoiceMacros(parsed, `${userReplacement}:${charName || ""}:${text}`);
  const replacements: Record<string, string | undefined> = {
    user: userReplacement,
    char: charName ?? "",
    charifnotgroup: charName ?? "",
    description: context.description,
    personality: context.personality,
    scenario: context.scenario,
    mesexamples: context.mesExamples,
    creator_notes: context.creatorNotes,
    creatornotes: context.creatorNotes,
    system_prompt: context.systemPrompt,
    systemprompt: context.systemPrompt,
    post_history_instructions: context.postHistoryInstructions,
    posthistoryinstructions: context.postHistoryInstructions,
    lastmessage: context.lastMessage,
  };
  parsed = parsed.replace(/{{\s*([a-z_]+)\s*}}/gi, (match, name: string) => {
    const replacement = replacements[name.toLowerCase()];
    return replacement === undefined ? match : replacement;
  });
  parsed = parsed
    .replace(/<USER>/gi, userReplacement)
    .replace(/<(?:BOT|CHAR)>/gi, charName ?? "");
  return parsed;
}
  
export function adaptCharacterData(
  characterData: any,
  language: Language,
  protagonistName?: string,
): any {
  const result = { ...characterData };
  const charReplacement = characterData.name || "";
  const macroContext: MacroContext = {
    description: characterData.description,
    personality: characterData.personality,
    scenario: characterData.scenario,
    mesExamples: characterData.mes_example,
    creatorNotes: characterData.creatorcomment || characterData.creator_notes,
    systemPrompt: characterData.system_prompt,
    postHistoryInstructions: characterData.post_history_instructions,
  };
  
  const fieldsToProcess = [
    "description", "personality", "first_mes", "scenario",
    "mes_example", "creatorcomment", "creator_notes", "system_prompt",
    "post_history_instructions",
  ];
  
  for (const field of fieldsToProcess) {
    if (result[field]) {
      let processed = adaptText(result[field], language, protagonistName, charReplacement, macroContext);
      result[field] = processed;
    }
  }
  
  if (result.character_book) {
    const bookEntries = Array.isArray(result.character_book)
      ? result.character_book
      : (result.character_book.entries || []);
  
    result.character_book = bookEntries.map((entry: any) => {
      const processedEntry = { ...entry };
  
      if (processedEntry.comment) {
        let processed = adaptText(processedEntry.comment, language, protagonistName, charReplacement, macroContext);
        processedEntry.comment = processed;
      }
  
      if (processedEntry.content) {
        let processed = adaptText(processedEntry.content, language, protagonistName, charReplacement, macroContext);
        processedEntry.content = processed;
      }
  
      return processedEntry;
    });
  }
  
  if (Array.isArray(result.alternate_greetings)) {
    for (let i = 0; i < result.alternate_greetings.length; i++) {
      let greeting = result.alternate_greetings[i];
      greeting = adaptText(greeting, language, protagonistName, charReplacement, macroContext);
      result.alternate_greetings[i] = greeting;
    }
  }

  if (result.depth_prompt?.prompt) {
    result.depth_prompt = {
      ...result.depth_prompt,
      prompt: adaptText(result.depth_prompt.prompt, language, protagonistName, charReplacement, macroContext),
    };
  }
  
  return result;
}
  
