import { WorldBookEntry } from "@/lib/models/world-book-model";

export interface RawCharacterData {
  id: any;
  name: string;
  description: string;
  personality: string;
  first_mes: string;
  scenario: string;
  mes_example: string;
  creatorcomment: string;
  avatar: string;
  sample_status: string;
  data:{
    name: string;
    description: string;
    personality: string;
    first_mes: string;
    scenario: string;
    mes_example: string;
    creator_notes: string;
    system_prompt: string;
    post_history_instructions: string;
    tags: string[];
    creator: string;
    character_version: string;
    alternate_greetings: string[];
    character_book:{
      entries: {
        comment: string;
        content: string;
        disable?: boolean;
        position?: number;
        constant?: boolean;
        key?: string[];
        order?: number;
        depth?: number;
      }[] | Record<string, WorldBookEntry>;
    }
  },
}
