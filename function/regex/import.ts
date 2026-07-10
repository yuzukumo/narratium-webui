import { RegexScriptOperations } from "@/lib/data/regex-script-operation";
import { RegexScript } from "@/lib/models/regex-script-model";
import { v4 as uuidv4 } from "uuid";

export interface ImportRegexScriptResult {
  success: boolean;
  message: string;
  importedCount: number;
  skippedCount: number;
  errors: string[];
  globalId?: string;
}

export async function importRegexScriptFromJson(
  characterId: string,
  jsonData: any,
  options?: {
    saveAsGlobal?: boolean;
    globalName?: string;
    globalDescription?: string;
    sourceCharacterName?: string;
  },
): Promise<ImportRegexScriptResult> {
  if (!characterId) {
    throw new Error("Character ID is required");
  }

  const result: ImportRegexScriptResult = {
    success: false,
    message: "",
    importedCount: 0,
    skippedCount: 0,
    errors: [],
  };

  try {
    const validation = validateRegexScriptJson(jsonData);
    if (!validation.valid) {
      result.errors = validation.errors;
      result.message = "Invalid JSON format";
      return result;
    }

    const scripts = await RegexScriptOperations.getRegexScripts(characterId) || {};
    const now = Date.now();
    
    let scriptEntries: any[] = [];
    
    if (Array.isArray(jsonData)) {
      scriptEntries = jsonData;
    } else if (jsonData.scripts && Array.isArray(jsonData.scripts)) {
      scriptEntries = jsonData.scripts;
    } else if (jsonData.regexScripts && Array.isArray(jsonData.regexScripts)) {
      scriptEntries = jsonData.regexScripts;
    } else if (typeof jsonData === "object" && !Array.isArray(jsonData) && jsonData.findRegex) {
      scriptEntries = [jsonData];
    } else {
      result.errors.push("Unsupported JSON format");
      result.message = "Unsupported JSON format";
      return result;
    }

    const importedScripts: Record<string, RegexScript> = {};

    for (const scriptData of scriptEntries) {
      try {
        const scriptId = `script_${uuidv4()}`;
        
        if (!scriptData.findRegex || typeof scriptData.findRegex !== "string") {
          result.skippedCount++;
          result.errors.push("Skipped script: missing or invalid findRegex");
          continue;
        }

        const regexScript: RegexScript = {
          scriptKey: scriptId,
          scriptName: scriptData.scriptName || scriptData.id || "Imported Script",
          findRegex: scriptData.findRegex,
          replaceString: scriptData.replaceString,
          trimStrings: Array.isArray(scriptData.trimStrings) ? scriptData.trimStrings : [],
          placement: Array.isArray(scriptData.placement) ? scriptData.placement : [scriptData.placement || 999],
          disabled: scriptData.disabled === true,
          extensions: {
            imported: true,
            importedAt: now,
          },
        };

        scripts[scriptId] = regexScript;
        importedScripts[scriptId] = regexScript;
        result.importedCount++;
      } catch (error: any) {
        result.errors.push(`Failed to import script: ${error.message}`);
        result.skippedCount++;
      }
    }

    if (result.importedCount > 0) {
      const updateResult = await RegexScriptOperations.updateRegexScripts(characterId, scripts);
      if (updateResult) {
        result.success = true;
        result.message = `Successfully imported ${result.importedCount} regex scripts`;
        
        if (options?.saveAsGlobal && options.globalName) {
          try {
            const store = await RegexScriptOperations["getRegexScriptStore"]();
            let nextId = 1;
            
            for (const key of Object.keys(store)) {
              if (key.startsWith("global_regex_") && key.endsWith("_settings")) {
                const match = key.match(/^global_regex_(\d+)_settings$/);
                if (match) {
                  const id = parseInt(match[1], 10);
                  if (id >= nextId) {
                    nextId = id + 1;
                  }
                }
              }
            }
            
            const globalId = `global_regex_${nextId}`;
            
            await RegexScriptOperations.updateRegexScripts(globalId, importedScripts);
            
            const now = Date.now();
            const metadata = {
              id: globalId,
              name: options.globalName,
              description: options.globalDescription || "",
              createdAt: now,
              updatedAt: now,
              scriptCount: Object.keys(importedScripts).length,
              sourceCharacterId: characterId,
              sourceCharacterName: options.sourceCharacterName,
            };
            
            await RegexScriptOperations.updateRegexScriptSettings(globalId, {
              enabled: true,
              applyToPrompt: false,
              applyToResponse: true,
              metadata,
            });
            
            result.globalId = globalId;
            result.message += ` and saved as global regex script "${options.globalName}"`;
          } catch (globalError: any) {
            result.errors.push(`Failed to save as global: ${globalError.message}`);
          }
        }
      } else {
        result.success = false;
        result.message = "Failed to save imported scripts";
      }
    } else {
      result.success = false;
      result.message = "No valid scripts found to import";
    }

    return result;
  } catch (error: any) {
    console.error("Failed to import regex scripts:", error);
    result.errors.push(error.message);
    result.message = `Import failed: ${error.message}`;
    return result;
  }
}

export function validateRegexScriptJson(jsonData: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!jsonData) {
    errors.push("Invalid JSON: Data is null or undefined");
    return { valid: false, errors };
  }

  if (typeof jsonData === "object" && !Array.isArray(jsonData) && jsonData.findRegex) {
    return { valid: true, errors: [] };
  }

  if (Array.isArray(jsonData)) {
    if (jsonData.length === 0) {
      errors.push("Empty array provided");
      return { valid: false, errors };
    }

    let hasValidScript = false;
    for (const script of jsonData) {
      if (typeof script === "object" && script !== null && script.findRegex) {
        hasValidScript = true;
        break;
      }
    }

    if (!hasValidScript) {
      errors.push("No valid scripts found with findRegex");
      return { valid: false, errors };
    }

    return { valid: true, errors: [] };
  }

  if (typeof jsonData !== "object") {
    errors.push("Invalid JSON: Root must be an object or array");
    return { valid: false, errors };
  }

  if (jsonData.scripts && Array.isArray(jsonData.scripts)) {
    if (jsonData.scripts.length === 0) {
      errors.push("No scripts found in scripts array");
      return { valid: false, errors };
    }
    
    let hasValidScript = false;
    for (const script of jsonData.scripts) {
      if (typeof script === "object" && script !== null && script.findRegex) {
        hasValidScript = true;
        break;
      }
    }

    if (!hasValidScript) {
      errors.push("No valid scripts found with findRegex");
      return { valid: false, errors };
    }

    return { valid: true, errors: [] };
  }

  if (jsonData.regexScripts && Array.isArray(jsonData.regexScripts)) {
    if (jsonData.regexScripts.length === 0) {
      errors.push("No scripts found in regexScripts array");
      return { valid: false, errors };
    }
    
    let hasValidScript = false;
    for (const script of jsonData.regexScripts) {
      if (typeof script === "object" && script !== null && script.findRegex) {
        hasValidScript = true;
        break;
      }
    }

    if (!hasValidScript) {
      errors.push("No valid scripts found with findRegex");
      return { valid: false, errors };
    }

    return { valid: true, errors: [] };
  }

  errors.push("Unsupported JSON format: Expected array or object with scripts/regexScripts array");
  return { valid: false, errors };
} 
