interface WorldBookEntryExtensions {
  position?: number;
  [key: string]: any;
}

export interface WorldBookEntry {
  entry_id?: string;
  id?: number;
  content: string;
  keys: string[];
  secondary_keys?: string[];
  selective: boolean;
  constant: boolean;
  position: string | number;
  insertion_order?: number;
  enabled?: boolean;
  use_regex?: boolean;
  depth?: number;
  comment?: string;
  tokens?: number;
  extensions?: WorldBookEntryExtensions;
}
