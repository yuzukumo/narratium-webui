import { LocalCharacterDialogueOperations } from "@/lib/data/character-dialogue-operation";
import { processedDialogueView } from "@/function/dialogue/view";

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
        ? LocalCharacterDialogueOperations.getDialoguePath(
          updatedDialogueTree,
          updatedDialogueTree.current_node_id,
        )
        : [];

    const processedDialogue = processedDialogueView(updatedDialogueTree, currentPath);

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
