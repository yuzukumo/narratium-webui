import { LocalCharacterRecordOperations } from "@/lib/data/character-record-operation";
import { adaptCharacterData } from "@/lib/adapter/tagReplacer";
import type { Language } from "@/lib/i18n/languages";
import { defaultProtagonistName } from "@/lib/i18n/languages";

export async function getAllCharacters(language: Language) {
  try {
    const characters = await LocalCharacterRecordOperations.getAllCharacters();

    const formattedCharacters = [...characters]
      .reverse()
      .map(character => {
        const characterData = {
          id: character.id,
          name: character.data.data?.name || character.data.name,
          description: character.data.data?.description || character.data.description,
          personality: character.data.data?.personality || character.data.personality,
          scenario: character.data.data?.scenario || character.data.scenario,
          first_mes: character.data.data?.first_mes || character.data.first_mes,
          mes_example: character.data.data?.mes_example || character.data.mes_example,
          creatorcomment: character.data.creatorcomment || character.data.data?.creator_notes,
          created_at: character.created_at,
          updated_at: character.updated_at,
          last_used_at: character.last_used_at,
          avatar_path: character.thumbnailPath || character.imagePath,
        };
        const processedData = adaptCharacterData(
          characterData,
          language,
          character.protagonistName?.trim() || defaultProtagonistName(language),
        );
        
        return processedData;
      });

    return formattedCharacters;
  } catch (error: any) {
    console.error("Failed to get characters:", error);
    throw new Error(`Failed to get characters: ${error.message}`);
  }
}
