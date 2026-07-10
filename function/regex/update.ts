import { RegexScript } from "@/lib/models/regex-script-model";
import { RegexScriptOperations } from "@/lib/data/regex-script-operation";

export async function updateRegexScript(
  characterId: string,
  scriptId: string,
  updates: Partial<RegexScript>,
): Promise<boolean> {
  try {
    return await RegexScriptOperations.updateRegexScript(characterId, scriptId, updates);
  } catch (error) {
    console.error("Error updating regex script:", error);
    throw new Error("Failed to update regex script");
  }
}
