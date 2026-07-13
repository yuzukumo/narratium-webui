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

function alternativesForNode(tree: DialogueTree, node: DialogueNode): DialogueNode[] {
  return tree.nodes.filter((candidate) => (
    candidate.node_id !== "root"
    && candidate.parent_node_id === node.parent_node_id
  ));
}

export function dialoguePathToMessages(
  tree: DialogueTree,
  path: DialogueNode[],
): DialogueViewMessage[] {
  return path.flatMap((node) => {
    if (node.node_id === "root") {
      return [];
    }

    const alternatives = alternativesForNode(tree, node);
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

    if (node.assistant_response) {
      messages.push({
        ...metadata,
        id: `${node.node_id}:assistant`,
        role: "assistant",
        content: node.parsed_content?.regexResult || node.assistant_response,
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
