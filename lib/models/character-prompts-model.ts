import type { Language } from "@/lib/i18n/languages";

export interface CharacterPromptParams {
  protagonistName?: string;
  name: string;
  number: number;
  prefixPrompt?: string;
  chainOfThoughtPrompt?: string;
  suffixPrompt?: string;
  language?: Language;
  systemPrompt?: string;
  storyHistory?: string;
  conversationHistory?: string;
  userInput?: string;
  sampleStatus?: string;
}

export enum PromptType {
  COMPANION = "companion",
  NSFW = "nsfw",
  EXPLICIT = "explicit",
  CUSTOM = "custom"
}
