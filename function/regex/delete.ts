import { RegexScriptSettings } from "@/lib/models/regex-script-model";
import { RegexScriptOperations } from "@/lib/data/regex-script-operation";  

export async function deleteRegexScript(characterId: string, scriptId: string): Promise<boolean> {
  try {
    return await RegexScriptOperations.deleteRegexScript(characterId, scriptId);
  } catch (error) {
    console.error("Error deleting regex script:", error);
    throw new Error("Failed to delete regex script");
  }
}
