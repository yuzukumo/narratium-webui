import { LocalCharacterDialogueOperations } from "@/lib/data/character-dialogue-operation";
import { LocalCharacterRecordOperations } from "@/lib/data/character-record-operation";
import { Character } from "@/lib/core/character";
import type { Language } from "@/lib/i18n/languages";
import { processedDialogueView } from "@/function/dialogue/view";

export async function getCharacterDialogue(characterId: string, language: Language = "zh") {
  if (!characterId) {
    throw new Error("Character ID is required");
  }

  try {
    const [characterRecord, dialogueTree] = await Promise.all([
      LocalCharacterRecordOperations.getCharacterById(characterId),
      LocalCharacterDialogueOperations.getDialogueTreeById(characterId),
    ]);
    const character = new Character(characterRecord);

    let processedDialogue = null;

    if (dialogueTree) {
      const currentPath = dialogueTree.current_node_id !== "root"
        ? LocalCharacterDialogueOperations.getDialoguePath(dialogueTree, dialogueTree.current_node_id)
        : [];

      processedDialogue = processedDialogueView(dialogueTree, currentPath);
    }

    return {
      success: true,
      character: {
        id: character.id,
        data: character.getData(language),
        imagePath: character.imagePath,
        thumbnailPath: character.thumbnailPath,
        protagonistName: character.protagonistName,
      },
      dialogue: processedDialogue,
    };
  } catch (error: any) {
    console.error("Failed to get character information:", error);
    throw new Error(`Failed to get character information: ${error.message}`);
  }
}
