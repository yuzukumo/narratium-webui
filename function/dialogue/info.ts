import { LocalCharacterDialogueOperations } from "@/lib/data/character-dialogue-operation";
import { LocalCharacterRecordOperations } from "@/lib/data/character-record-operation";
import { Character } from "@/lib/core/character";

export async function getCharacterDialogue(characterId: string, language: "en" | "zh" = "zh", username?: string) {
  if (!characterId) {
    throw new Error("Character ID is required");
  }

  try {
    const characterRecord = await LocalCharacterRecordOperations.getCharacterById(characterId);
    const character = new Character(characterRecord);

    const dialogueTree = await LocalCharacterDialogueOperations.getDialogueTreeById(characterId);

    let processedDialogue = null;

    if (dialogueTree) {
      const currentPath = dialogueTree.current_node_id !== "root"
        ? await LocalCharacterDialogueOperations.getDialoguePathToNode(characterId, dialogueTree.current_node_id)
        : [];

      const messages = [];

      for (const node of currentPath) {
        if (node.user_input) {
          messages.push({
            id: node.node_id,
            role: "user",
            content: node.user_input,
            parsedContent: null,
          });
        }

        if (node.assistant_response) {
          if (node.parsed_content?.regexResult) {
            messages.push({
              id: node.node_id,
              role: "assistant",
              content: node.parsed_content.regexResult,
              parsedContent: node.parsed_content,
            });
          }
          else {
            messages.push({
              id: node.node_id,
              role: "assistant",
              content: node.assistant_response,
              parsedContent: node.parsed_content || null,
            });
          }
        }
      }

      processedDialogue = {
        id: dialogueTree.id,
        character_id: dialogueTree.character_id,
        current_node_id: dialogueTree.current_node_id,
        created_at: dialogueTree.created_at,
        updated_at: dialogueTree.updated_at,
        messages,
        tree: {
          nodes: dialogueTree.nodes,
          currentNodeId: dialogueTree.current_node_id,
        },
      };
    }

    return {
      success: true,
      character: {
        id: character.id,
        data: character.getData(language, username),
        imagePath: character.imagePath,
      },
      dialogue: processedDialogue,
    };
  } catch (error: any) {
    console.error("Failed to get character information:", error);
    throw new Error(`Failed to get character information: ${error.message}`);
  }
}
