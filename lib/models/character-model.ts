import type { CharacterDepthPrompt } from "@/lib/models/rawdata-model";

export interface CharacterData {
  name: string;
  description: string;
  personality: string;
  first_mes: string;
  scenario: string;
  mes_example: string;
  creatorcomment: string;
  avatar: string;
  creator_notes?: string;
  system_prompt: string;
  post_history_instructions: string;
  tags: string[];
  creator: string;
  character_version: string;
  nickname?: string;
  imagePath?: string;
  alternate_greetings: string[];
  group_only_greetings: string[];
  depth_prompt?: CharacterDepthPrompt;
}
