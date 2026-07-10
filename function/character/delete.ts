import { LocalCharacterDialogueOperations } from "@/lib/data/character-dialogue-operation";
import { LocalCharacterRecordOperations } from "@/lib/data/character-record-operation";
import { RegexScriptOperations } from "@/lib/data/regex-script-operation";
import { WorldBookOperations } from "@/lib/data/world-book-operation";
import { deleteBlob } from "@/lib/data/local-storage";

export async function deleteCharacter(character_id: string): Promise<{ success?: boolean; error?: string }> {
  try {
    if (!character_id) {
      return { error: "Character ID is required" };
    }

    const character = await LocalCharacterRecordOperations.getCharacterById(character_id);
    if (!character) {
      return { error: "Character not found" };
    }

    const deleted = await LocalCharacterRecordOperations.deleteCharacter(character_id);
    if (!deleted) {
      return { error: "Failed to delete character" };
    }

    await LocalCharacterDialogueOperations.deleteDialogueTree(character_id);

    try {
      const worldBooks = await WorldBookOperations["getWorldBooks"]();
      
      if (worldBooks[character_id]) {
        delete worldBooks[character_id];
      }
      
      if (worldBooks[`${character_id}_settings`]) {
        delete worldBooks[`${character_id}_settings`];
      }
      
      await WorldBookOperations["saveWorldBooks"](worldBooks);
    } catch (worldBookErr) {
      console.warn("Failed to delete world book:", worldBookErr);
    }
    try {
      const scriptStore = await RegexScriptOperations["getRegexScriptStore"]();
      
      if (scriptStore[character_id]) {
        delete scriptStore[character_id];
      }
      
      if (scriptStore[`${character_id}_settings`]) {
        delete scriptStore[`${character_id}_settings`];
      }
      
      await RegexScriptOperations["saveRegexScriptStore"](scriptStore);
    } catch (regexErr) {
      console.warn("Failed to delete regex scripts:", regexErr);
    }

    const avatarPath = character.imagePath;
    if (avatarPath) {
      try {
        await deleteBlob(avatarPath);
      } catch (blobErr) {
        console.warn("Failed to delete avatar blob:", blobErr);
      }
    }

    return { success: true };
  } catch (err: any) {
    console.error("Failed to delete character:", err);
    return { error: `Failed to delete character: ${err.message}` };
  }
}
