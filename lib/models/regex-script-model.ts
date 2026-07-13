export interface RegexScript {
  scriptKey: string;
  id?: string; 
  scriptName: string;
  findRegex: string;
  replaceString?: string | null;
  trimStrings: string[];
  placement: number[];
  disabled?: boolean;
  markdownOnly?: boolean;
  promptOnly?: boolean;
  runOnEdit?: boolean;
  substituteRegex?: number;
  minDepth?: number | null;
  maxDepth?: number | null;
  extensions?: {
    imported?: boolean;
    importedAt?: number;
    globalSource?: boolean;
    globalSourceId?: string;
    globalSourceName?: string;
    trusted?: boolean;
    [key: string]: unknown;
  };
}

export enum RegexPlacement {
  MARKDOWN_DISPLAY = 0,
  USER_INPUT = 1,
  AI_OUTPUT = 2,
  SLASH_COMMAND = 3,
  WORLD_INFO = 5,
  REASONING = 6,
}

export enum RegexScriptOwnerType {
  CHARACTER = "character",
  GLOBAL = "global",
  CONVERSATION = "conversation"
}

export interface RegexReplacementResult {
  originalText: string;
  replacedText: string;
  appliedScripts: string[];
  success: boolean;
}

export interface RegexScriptSettings {
  enabled: boolean;
  applyToPrompt: boolean;
  applyToResponse: boolean;
  metadata?: any;
}
