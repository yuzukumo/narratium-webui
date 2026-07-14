import { ParsedResponse } from "@/lib/models/parsed-response";
import { PromptType } from "@/lib/models/character-prompts-model";
import type { Language } from "@/lib/i18n/languages";

export interface DialogueMessage {
  role: "user" | "assistant" | "system" | "sample" | "error";
  content: string;
  parsedContent?: ParsedResponse;
  id: string | number;
  nodeId?: string;
  parentNodeId?: string;
  alternativeIndex?: number;
  alternativeCount?: number;
  alternativeNodeIds?: string[];
  timestamp?: string;
}

export interface DialogueOptions {
  modelId: string;
  temperature?: number;
  maxTokens?: number;
  language?: Language;
  promptType?: PromptType;
  contextWindow?: number;
}
