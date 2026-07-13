import { LocalCharacterDialogueOperations } from "@/lib/data/character-dialogue-operation";
import { processedDialogueView } from "@/function/dialogue/view";

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

    const processedDialogue = processedDialogueView(updatedDialogueTree, currentPath);

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
