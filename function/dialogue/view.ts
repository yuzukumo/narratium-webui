import type { DialogueMessage } from "@/lib/models/character-dialogue-model";
import type { DialogueNode, DialogueTree } from "@/lib/models/node-model";

export interface DialogueViewMessage extends DialogueMessage {
  id: string;
  nodeId: string;
  parentNodeId: string;
  alternativeIndex: number;
  alternativeCount: number;
  alternativeNodeIds: string[];
  timestamp: string;
}

export function dialoguePathToMessages(
  tree: DialogueTree,
  path: DialogueNode[],
): DialogueViewMessage[] {
  const alternativesByParent = new Map<string, DialogueNode[]>();
  for (const candidate of tree.nodes) {
    if (candidate.node_id === "root") continue;
    const siblings = alternativesByParent.get(candidate.parent_node_id);
    if (siblings) siblings.push(candidate);
    else alternativesByParent.set(candidate.parent_node_id, [candidate]);
  }

  return path.flatMap((node) => {
    if (node.node_id === "root") {
      return [];
    }

    const alternatives = alternativesByParent.get(node.parent_node_id) || [];
    const alternativeNodeIds = alternatives.map((candidate) => candidate.node_id);
    const alternativeIndex = Math.max(
      alternativeNodeIds.indexOf(node.node_id) + 1,
      1,
    );
    const metadata = {
      nodeId: node.node_id,
      parentNodeId: node.parent_node_id,
      alternativeIndex,
      alternativeCount: Math.max(alternativeNodeIds.length, 1),
      alternativeNodeIds: alternativeNodeIds.length > 0
        ? alternativeNodeIds
        : [node.node_id],
      timestamp: node.created_at || tree.created_at,
    };
    const messages: DialogueViewMessage[] = [];

    if (node.user_input) {
      messages.push({
        ...metadata,
        id: `${node.node_id}:user`,
        role: "user",
        content: node.user_input,
      });
    }

    const generationStatus = node.parsed_content?.generationStatus;
    const responseContent = node.parsed_content?.regexResult
      || node.assistant_response
      || node.parsed_content?.errorMessage
      || "";
    const hasResponseState = responseContent || (generationStatus && generationStatus !== "pending");

    if (hasResponseState) {
      messages.push({
        ...metadata,
        id: `${node.node_id}:assistant`,
        role: generationStatus && generationStatus !== "completed" && !node.assistant_response
          ? "error"
          : "assistant",
        content: responseContent,
        parsedContent: node.parsed_content,
      });
    }

    return messages;
  });
}

export function processedDialogueView(
  tree: DialogueTree,
  path: DialogueNode[],
) {
  return {
    id: tree.id,
    character_id: tree.character_id,
    current_node_id: tree.current_node_id,
    created_at: tree.created_at,
    updated_at: tree.updated_at,
    messages: dialoguePathToMessages(tree, path),
    tree: {
      nodes: tree.nodes,
      currentNodeId: tree.current_node_id,
    },
  };
}
