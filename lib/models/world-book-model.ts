interface WorldBookEntryExtensions {
  position?: number;
  depth?: number;
  outlet_name?: string;
  probability?: number;
  useProbability?: boolean;
  selectiveLogic?: number;
  case_sensitive?: boolean;
  match_whole_words?: boolean;
  role?: number;
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
  outletName?: string;
  insertion_order?: number;
  enabled?: boolean;
  case_sensitive?: boolean;
  use_regex?: boolean;
  depth?: number;
  comment?: string;
  tokens?: number;
  extensions?: WorldBookEntryExtensions;
}
