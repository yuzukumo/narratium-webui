import { parseCharacterCard } from "@/utils/character-parser";
import { LocalCharacterRecordOperations } from "@/lib/data/character-record-operation";
import { setBlob } from "@/lib/data/local-storage";
import { WorldBookOperations } from "@/lib/data/world-book-operation";
import { RegexScriptOperations } from "@/lib/data/regex-script-operation";
import { RegexScript } from "@/lib/models/regex-script-model";
import { v4 as uuidv4 } from "uuid";

export async function handleCharacterUpload(file: File) {
  if (!file || !file.name.toLowerCase().endsWith(".png")) {
    throw new Error("Unsupported or missing file.");
  }

  try {
    const characterData = await parseCharacterCard(file);
    const characterJson = JSON.parse(characterData);

    const characterId = `char_${Date.now()}`;
    const imagePath = `${characterId}.png`;

    if (characterJson.data?.character_book?.entries) {
      await WorldBookOperations.updateWorldBook(characterId, characterJson.data.character_book.entries);
    }

    if (characterJson.data?.extensions?.regex_scripts) {
      const regexScripts = characterJson.data.extensions.regex_scripts;

      if (Array.isArray(regexScripts)) {
        regexScripts.forEach(script => {
          if (!script.scriptKey) {
            script.scriptKey = `script_${uuidv4()}`;
          }
        });
        await RegexScriptOperations.updateRegexScripts(characterId, regexScripts);
      } 
      else if (typeof regexScripts === "object") {
        const scriptsArray = Object.values(regexScripts).filter(script => 
          script && typeof script === "object",
        ) as RegexScript[];
        
        if (scriptsArray.length > 0) {
          scriptsArray.forEach(script => {
            if (!script.scriptKey) {
              script.scriptKey = `script_${uuidv4()}`;
            }
          });
          await RegexScriptOperations.updateRegexScripts(characterId, scriptsArray);
        }
      }
    }

    await LocalCharacterRecordOperations.createCharacter(
      characterId,
      characterJson,
      imagePath,
    );

    await setBlob(imagePath, file);

    return {
      success: true,
      characterId,
      characterData: characterJson,
      imagePath,
      hasWorldBook: !!characterJson.data?.character_book?.entries,
      hasRegexScripts: !!characterJson.data?.extensions?.regex_scripts,
    };
  } catch (error: any) {
    console.error("Failed to parse character data:", error);
    throw new Error(`Failed to parse character data: ${error.message}`);
  }
}
