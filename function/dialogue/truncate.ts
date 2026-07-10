import { LocalCharacterDialogueOperations } from "@/lib/data/character-dialogue-operation";

interface SwitchDialogueBranchOptions {
  characterId: string;
  nodeId: string;
}

export async function switchDialogueBranch({ characterId, nodeId }: SwitchDialogueBranchOptions) {

  try {
    const dialogueTree = await LocalCharacterDialogueOperations.getDialogueTreeById(characterId);

    if (!dialogueTree) {
      throw new Error("Dialogue not found");
    }

    const updated = await LocalCharacterDialogueOperations.switchBranch(characterId, nodeId);
    if (!updated) {
      throw new Error("Failed to switch to the specified node");
    }

    const updatedDialogueTree = await LocalCharacterDialogueOperations.getDialogueTreeById(characterId);
    if (!updatedDialogueTree) {
      throw new Error("Failed to retrieve updated dialogue");
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
      message: "成功切换到指定对话节点",
      dialogue: processedDialogue,
    };
  } catch (error: any) {
    console.error("Error switching dialogue branch:", error);
    throw new Error(`Failed to switch dialogue branch: ${error.message}`);
  }
}
