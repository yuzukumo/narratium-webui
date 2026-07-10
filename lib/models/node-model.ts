import { ParsedResponse } from "@/lib/models/parsed-response";

export class DialogueNode {
  node_id: string;
  parent_node_id: string;
  user_input: string;
  assistant_response: string;
  full_response: string;
  parsed_content?: ParsedResponse;
  created_at: string;
  
  constructor(
    node_id: string,
    parent_node_id: string,
    user_input: string,
    assistant_response: string,
    full_response: string,
    parsed_content?: ParsedResponse,
    created_at: string = new Date().toISOString(),
  ) {
    this.node_id = node_id;
    this.parent_node_id = parent_node_id;
    this.user_input = user_input;
    this.assistant_response = assistant_response;
    this.full_response = full_response;
    this.parsed_content = parsed_content;
    this.created_at = created_at;
  }
}

export class DialogueTree {
  id: string;
  character_id: string;
  current_node_id: string;
  
  nodes: DialogueNode[];
  created_at: string;
  updated_at: string;
  
  constructor(
    id: string,
    character_id: string,
    nodes: DialogueNode[] = [],
    current_node_id: string = "root",
    created_at: string = new Date().toISOString(),
    updated_at: string = new Date().toISOString(),
  ) {
    this.id = id;
    this.character_id = character_id;
    this.nodes = nodes;
    this.current_node_id = current_node_id;
    this.created_at = created_at;
    this.updated_at = updated_at;
  }
}
