import { LocalCharacterDialogueOperations } from "@/lib/data/character-dialogue-operation";

interface DeleteDialogueNodeOptions {
  characterId: string;
  nodeId: string;
}

export async function deleteDialogueNode({ characterId, nodeId }: DeleteDialogueNodeOptions) {
  try {
    const updatedDialogueTree = await LocalCharacterDialogueOperations.deleteNode(characterId, nodeId);
    
    if (!updatedDialogueTree) {
      throw new Error("Failed to delete node or node not found");
    }

    const currentPath =
      updatedDialogueTree.current_node_id !== "root"
        ? await LocalCharacterDialogueOperations.getDialoguePathToNode(
          characterId,
          updatedDialogueTree.current_node_id,
        )
        : [];

    const messages = currentPath.flatMap((node) => {
      const msgs = [];

      if (node.user_input) {
        msgs.push({
          id: node.node_id,
          role: "user",
          content: node.user_input,
          parsedContent: null,
        });
      }

      if (node.assistant_response) {
        msgs.push({
          id: node.node_id,
          role: "assistant",
          content: node.assistant_response,
          parsedContent: node.parsed_content || null,
          node_id: node.node_id,
        });
      }

      return msgs;
    });

    const processedDialogue = {
      id: updatedDialogueTree.id,
      character_id: updatedDialogueTree.character_id,
      current_node_id: updatedDialogueTree.current_node_id,
      created_at: updatedDialogueTree.created_at,
      updated_at: updatedDialogueTree.updated_at,
      messages,
      tree: {
        nodes: updatedDialogueTree.nodes,
        currentNodeId: updatedDialogueTree.current_node_id,
      },
    };

    return {
      success: true,
      message: "Successfully deleted dialogue node",
      dialogue: processedDialogue,
    };
  } catch (error: any) {
    console.error("Error deleting dialogue node:", error);
    throw new Error(`Failed to delete dialogue node: ${error.message}`);
  }
} 
