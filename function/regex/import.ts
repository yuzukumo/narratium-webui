import { RegexScriptOperations } from "@/lib/data/regex-script-operation";
import { RegexScript } from "@/lib/models/regex-script-model";
import { v4 as uuidv4 } from "uuid";
import { normalizeRegexScript } from "@/lib/character-card/normalize";

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
    
    const scriptEntries = extractRegexScriptEntries(jsonData);
    if (!scriptEntries) {
      result.errors.push("Unsupported JSON format");
      result.message = "Unsupported JSON format";
      return result;
    }

    const importedScripts: Record<string, RegexScript> = {};

    for (const scriptData of scriptEntries) {
      try {
        const scriptId = `script_${uuidv4()}`;
        
        const normalized = normalizeRegexScript(scriptData, 0);
        if (!normalized) {
          result.skippedCount++;
          result.errors.push("Skipped script: invalid structure");
          continue;
        }
        const regexScript: RegexScript = {
          ...normalized,
          scriptKey: scriptId,
          extensions: {
            ...normalized.extensions,
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
  if (!jsonData) {
    return { valid: false, errors: ["Invalid JSON: Data is null or undefined"] };
  }
  const scripts = extractRegexScriptEntries(jsonData);
  if (!scripts || scripts.length === 0) {
    return { valid: false, errors: ["No regex scripts found"] };
  }
  return scripts.some(isRegexScript)
    ? { valid: true, errors: [] }
    : { valid: false, errors: ["No valid scripts found with findRegex"] };
}

function isRegexScript(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const script = value as Record<string, unknown>;
  const expression = script.findRegex ?? script.find_regex;
  return typeof expression === "string" && expression.length > 0;
}

function extractRegexScriptEntries(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return null;
  if (isRegexScript(value)) return [value];
  const source = value as Record<string, unknown>;
  for (const key of ["scripts", "regexScripts", "regex_scripts"]) {
    const candidate = source[key];
    if (Array.isArray(candidate)) return candidate;
    if (candidate && typeof candidate === "object") return Object.values(candidate);
  }
  const directEntries = Object.values(source);
  return directEntries.some(isRegexScript) ? directEntries : null;
}
