import { RegexScript } from "@/lib/models/regex-script-model";
import { RegexScriptOperations } from "@/lib/data/regex-script-operation";

export async function getRegexScripts(characterId: string): Promise<Record<string, RegexScript> | null> {
  try {
    return await RegexScriptOperations.getRegexScripts(characterId);
  } catch (error) {
    console.error("Error getting regex scripts:", error);
    throw new Error("Failed to get regex scripts");
  }
}
