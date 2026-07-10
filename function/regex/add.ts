import { RegexScript } from "@/lib/models/regex-script-model";
import { RegexScriptOperations } from "@/lib/data/regex-script-operation";

export async function addRegexScript(characterId: string, script: RegexScript): Promise<string | null> {
  try {
    return await RegexScriptOperations.addRegexScript(characterId, script);
  } catch (error) {
    console.error("Error adding regex script:", error);
    throw new Error("Failed to add regex script");
  }
}
