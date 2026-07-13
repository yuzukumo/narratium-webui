import { WorldBookEntry } from "@/lib/models/world-book-model";

export interface CharacterBook {
  name?: string;
  description?: string;
  scan_depth?: number;
  token_budget?: number;
  recursive_scanning?: boolean;
  entries: WorldBookEntry[] | Record<string, WorldBookEntry>;
  extensions?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface CharacterDepthPrompt {
  prompt: string;
  depth: number;
  role: "system" | "user" | "assistant";
}

export interface RawCharacterCardData {
  name: string;
  description: string;
  personality: string;
  first_mes: string;
  scenario: string;
  mes_example: string;
  creator_notes: string;
  system_prompt: string;
  post_history_instructions: string;
  alternate_greetings: string[];
  group_only_greetings: string[];
  tags: string[];
  creator: string;
  character_version: string;
  nickname?: string;
  character_book?: CharacterBook;
  depth_prompt?: CharacterDepthPrompt;
  extensions: Record<string, unknown>;
  [key: string]: unknown;
}

export interface RawCharacterData {
  spec?: string;
  spec_version?: string;
  name: string;
  description: string;
  personality: string;
  first_mes: string;
  scenario: string;
  mes_example: string;
  creatorcomment: string;
  avatar: string;
  sample_status?: string;
  data: RawCharacterCardData;
  [key: string]: unknown;
}
