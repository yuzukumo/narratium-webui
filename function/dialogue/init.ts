import { Character } from "@/lib/core/character";
import { LocalCharacterDialogueOperations } from "@/lib/data/character-dialogue-operation";
import { LocalCharacterRecordOperations } from "@/lib/data/character-record-operation";
import { adaptText } from "@/lib/adapter/tagReplacer";
import { RegexProcessor } from "@/lib/core/regex-processor";
import { RegexPlacement } from "@/lib/models/regex-script-model";
import type { Language } from "@/lib/i18n/languages";
import { defaultProtagonistName } from "@/lib/i18n/languages";

interface InitCharacterDialogueOptions {
  characterId: string;
  language?: Language;
}

export async function initCharacterDialogue(options: InitCharacterDialogueOptions) {
  const { characterId, language = "zh" } = options;

  if (!characterId) {
    throw new Error("Missing required parameters");
  }

  try {
    const characterRecord = await LocalCharacterRecordOperations.getCharacterById(characterId);
    if (!characterRecord) {
      throw new Error("Character not found");
    }

    const character = new Character(characterRecord);
    const protagonistName = character.protagonistName || defaultProtagonistName(language);
    const firstAssistantMessage = await character.getFirstMessage();
    let dialogueTree = await LocalCharacterDialogueOperations.getDialogueTreeById(characterId);

    if (!dialogueTree) {
      dialogueTree = await LocalCharacterDialogueOperations.createDialogueTree(characterId);
    }

    let nodeIds: string[] = [];
    if (firstAssistantMessage) {
      const messagesToProcess = [...firstAssistantMessage];
      let firstProcessedMessage = "";

      if (messagesToProcess.length > 0) {
        const firstMessage = messagesToProcess[0];
        const adaptedFirstMessage = adaptText(firstMessage, language, protagonistName, character.characterData.name);
        
        const firstRegexResult = await RegexProcessor.processFullContext(
          adaptedFirstMessage, 
          { 
            ownerId: characterId, 
            placement: RegexPlacement.AI_OUTPUT,
            isMarkdown: true,
            depth: 0,
            protagonistName,
            charName: character.characterData.name,
          },
        );
        
        firstProcessedMessage = firstRegexResult.replacedText;
      }

      for (const message of messagesToProcess) {
        const adaptedMessage = adaptText(message, language, protagonistName, character.characterData.name);
        
        const regexResult = await RegexProcessor.processFullContext(
          adaptedMessage, 
          { 
            ownerId: characterId, 
            placement: RegexPlacement.AI_OUTPUT,
            isMarkdown: true,
            depth: 0,
            protagonistName,
            charName: character.characterData.name,
          },
        );
        
        const processedMessage = regexResult.replacedText;
        
        const nodeId = await LocalCharacterDialogueOperations.addNodeToDialogueTree(
          characterId,
          "root",
          "",
          adaptedMessage,
          adaptedMessage,
          {
            nextPrompts: [],
            regexResult: processedMessage,
            compressedContent: "",
          },
          undefined,
        );
        nodeIds.push(nodeId);
      }
      if (nodeIds[0]) {
        await LocalCharacterDialogueOperations.switchBranch(characterId, nodeIds[0]);
      }
      
      return {
        success: true,
        characterId,
        firstMessage: firstProcessedMessage,
        nodeId: nodeIds[0],
        alternativeNodeIds: nodeIds,
      };
    }

    throw new Error("No assistant message generated");
  } catch (error: any) {
    console.error("Failed to initialize character dialogue:", error);
    throw new Error(`Failed to initialize dialogue: ${error.message}`);
  }
}
