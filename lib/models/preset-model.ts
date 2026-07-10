export interface PresetPrompt {
  identifier: string;
  name: string;
  enabled?: boolean;
  marker?: boolean;
  role?: string;
  content?: string;
  forbid_overrides?: boolean;
  group_id?: string | number;
  position?: number;
}

export interface Preset {
  id?: string;
  name: string;
  enabled?: boolean;
  prompts: PresetPrompt[];
  created_at?: string;
  updated_at?: string;
}
