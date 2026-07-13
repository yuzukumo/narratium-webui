import { LocalCharacterDialogueOperations } from "@/lib/data/character-dialogue-operation";
import { CharacterDialogue } from "@/lib/core/character-dialogue";
import { parseEvent } from "@/utils/response-parser";
import { DialogueNode } from "@/lib/models/node-model";
import { LocalCharacterRecordOperations } from "@/lib/data/character-record-operation";
import { Character } from "@/lib/core/character";
import type { Language } from "@/lib/i18n/languages";

interface EditDialogueNodeRequest {
  characterId: string;
  nodeId: string;
  assistantResponse: string;
  model_id: string;
  language: string;
}

export async function editDialaogueNodeContent(input: EditDialogueNodeRequest) {
  try {
    const { 
      characterId, 
      nodeId, 
      assistantResponse,
      model_id,
      language,
    } = input;
    
    const dialogueTree = await LocalCharacterDialogueOperations.getDialogueTreeById(characterId);
    if (!dialogueTree) {
      throw new Error("Dialogue tree not found");
    }
    
    const node = dialogueTree.nodes.find((n) => n.node_id === nodeId);
    if (!node) {
      throw new Error("Node not found");
    }

    const characterRecord = await LocalCharacterRecordOperations.getCharacterById(characterId);
    const character = new Character(characterRecord);
    
    const dialogue = new CharacterDialogue(character);
    await dialogue.initialize({
      modelId: model_id,
      language: language as Language,
    });
    
    let summary = "";
    try {
      const compressedResult = await dialogue.compressStory(
        node.user_input || "",
        assistantResponse,
      );
      summary = parseEvent(compressedResult);
    } catch (compressionError) {
      console.error("Error generating summary:", compressionError);
      throw new Error("Failed to generate summary");
    }

    const nodeUpdates: Partial<DialogueNode> = {
      assistant_response: assistantResponse,
      parsed_content: {
        compressedContent: summary,
      },
    };

    const updatedDialogue = await LocalCharacterDialogueOperations.updateNodeInDialogueTree(
      dialogueTree.id,
      nodeId,
      nodeUpdates,
    );
    
    if (!updatedDialogue) {
      throw new Error("Failed to update node content");
    }

    return {
      success: true,
      dialogue: updatedDialogue,
      summary: summary,
    };
  } catch (error) {
    console.error("Edit dialogue node content error:", error);
    throw new Error("Edit dialogue node content failed");
  }
}
