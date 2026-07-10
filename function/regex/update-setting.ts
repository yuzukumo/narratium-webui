import { RegexScriptSettings } from "@/lib/models/regex-script-model";
import { RegexScriptOperations } from "@/lib/data/regex-script-operation";  

export async function updateRegexScriptSettings(
  characterId: string,
  updates: Partial<RegexScriptSettings>,
): Promise<RegexScriptSettings> {
  try {
    return await RegexScriptOperations.updateRegexScriptSettings(characterId, updates);
  } catch (error) {
    console.error("Error updating regex script settings:", error);
    throw new Error("Failed to update regex script settings");
  }
} 
