import { WorldBookOperations } from "@/lib/data/world-book-operation";
import { WorldBookEntry } from "@/lib/models/world-book-model";
import { v4 as uuidv4 } from "uuid";
import { saveAsGlobalWorldBook } from "./global";

export interface ImportWorldBookResult {
  success: boolean;
  message: string;
  importedCount: number;
  skippedCount: number;
  errors: string[];
  globalId?: string;
}

export async function importWorldBookFromJson(
  characterId: string,
  jsonData: any,
  options?: {
    saveAsGlobal?: boolean;
    globalName?: string;
    globalDescription?: string;
    sourceCharacterName?: string;
  },
): Promise<ImportWorldBookResult> {
  if (!characterId) {
    throw new Error("Character ID is required");
  }

  const result: ImportWorldBookResult = {
    success: false,
    message: "",
    importedCount: 0,
    skippedCount: 0,
    errors: [],
  };

  try {
    const validation = validateWorldBookJson(jsonData);
    if (!validation.valid) {
      result.errors = validation.errors;
      result.message = "Invalid JSON format";
      return result;
    }

    const worldBook = await WorldBookOperations.getWorldBook(characterId) || {};
    const now = Date.now();

    let entries: any[] = [];
    
    if (jsonData.entries && typeof jsonData.entries === "object") {
      entries = Object.values(jsonData.entries);
    } else if (Array.isArray(jsonData)) {
      entries = jsonData;
    } else if (jsonData.worldBook && Array.isArray(jsonData.worldBook)) {
      entries = jsonData.worldBook;
    } else {
      result.errors.push("Unsupported JSON format");
      result.message = "Unsupported JSON format";
      return result;
    }

    for (const entryData of entries) {
      try {
        const entryId = `entry_${uuidv4()}`;
        
        let keys: string[] = [];
        let secondary_keys: string[] = [];
        let content = "";
        let comment = "";
        let position = 4;
        let depth = 1;
        let enabled = true;
        let selective = false;
        let constant = false;
        let use_regex = false;
        let insertion_order = 0;

        if (entryData.key !== undefined) {
          keys = Array.isArray(entryData.key) ? entryData.key.filter((k: string) => k && k.trim()) : [];
        }
        if (entryData.keysecondary !== undefined) {
          secondary_keys = Array.isArray(entryData.keysecondary) ? entryData.keysecondary.filter((k: string) => k && k.trim()) : [];
        }
        if (entryData.content !== undefined) {
          content = typeof entryData.content === "string" ? entryData.content : String(entryData.content || "");
        }
        if (entryData.comment !== undefined) {
          comment = String(entryData.comment || "");
        }
        if (entryData.position !== undefined) {
          position = Number(entryData.position) || 4;
        }
        if (entryData.depth !== undefined) {
          depth = Number(entryData.depth) || 1;
        }
        if (entryData.disable !== undefined) {
          enabled = !entryData.disable;
        }
        if (entryData.selective !== undefined) {
          selective = Boolean(entryData.selective);
        }
        if (entryData.constant !== undefined) {
          constant = Boolean(entryData.constant);
        }
        if (entryData.order !== undefined) {
          insertion_order = Number(entryData.order) || 0;
        }

        if (entryData.keys !== undefined) {
          keys = Array.isArray(entryData.keys) ? entryData.keys.filter((k: string) => k && k.trim()) : [];
        }
        if (entryData.secondary_keys !== undefined) {
          secondary_keys = Array.isArray(entryData.secondary_keys) ? entryData.secondary_keys.filter((k: string) => k && k.trim()) : [];
        }
        if (entryData.content !== undefined) {
          content = String(entryData.content || "");
        }
        if (entryData.enabled !== undefined) {
          enabled = Boolean(entryData.enabled);
        }
        if (entryData.use_regex !== undefined) {
          use_regex = Boolean(entryData.use_regex);
        }
        if (entryData.insertion_order !== undefined) {
          insertion_order = Number(entryData.insertion_order) || 0;
        }
        if (!content.trim() && keys.length === 0) {
          result.skippedCount++;
          continue;
        }

        const worldBookEntry: WorldBookEntry = {
          content: content.trim(),
          keys: keys,
          secondary_keys: secondary_keys,
          selective: selective,
          constant: constant,
          position: position,
          insertion_order: insertion_order,
          enabled: enabled,
          use_regex: use_regex,
          depth: depth,
          comment: comment.trim(),
          tokens: undefined,
          extensions: {
            position: position,
            depth: depth,
            createdAt: now,
            updatedAt: now,
            imported: true,
            importedAt: now,
          },
        };

        worldBook[entryId] = worldBookEntry;
        result.importedCount++;
      } catch (error: any) {
        result.errors.push(`Failed to import entry: ${error.message}`);
        result.skippedCount++;
      }
    }

    if (result.importedCount > 0) {
      const updateResult = await WorldBookOperations.updateWorldBook(characterId, worldBook);
      if (updateResult) {
        result.success = true;
        result.message = `Successfully imported ${result.importedCount} entries`;
        
        if (options?.saveAsGlobal && options.globalName) {
          try {
            const globalResult = await saveAsGlobalWorldBook(
              characterId,
              options.globalName,
              options.globalDescription,
              options.sourceCharacterName,
            );
            if (globalResult.success && globalResult.globalId) {
              result.globalId = globalResult.globalId;
              result.message += ` and saved as global world book "${options.globalName}"`;
            }
          } catch (globalError: any) {
            result.errors.push(`Failed to save as global: ${globalError.message}`);
          }
        }
      } else {
        result.success = false;
        result.message = "Failed to save imported entries";
      }
    } else {
      result.success = false;
      result.message = "No valid entries found to import";
    }

    return result;
  } catch (error: any) {
    console.error("Failed to import world book:", error);
    result.errors.push(error.message);
    result.message = `Import failed: ${error.message}`;
    return result;
  }
}

export function validateWorldBookJson(jsonData: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!jsonData || typeof jsonData !== "object") {
    errors.push("Invalid JSON: Root must be an object");
    return { valid: false, errors };
  }

  if (jsonData.entries && typeof jsonData.entries === "object") {
    const entries = Object.values(jsonData.entries);
    if (entries.length === 0) {
      errors.push("No entries found in SillyTavern format");
      return { valid: false, errors };
    }

    let hasValidEntry = false;
    for (const entry of entries) {
      if (typeof entry === "object" && entry !== null) {
        const entryObj = entry as any;
        if (entryObj.content || (entryObj.key && Array.isArray(entryObj.key) && entryObj.key.length > 0)) {
          hasValidEntry = true;
          break;
        }
      }
    }

    if (!hasValidEntry) {
      errors.push("No valid entries found with content or keys");
      return { valid: false, errors };
    }

    return { valid: true, errors: [] };
  }

  if (Array.isArray(jsonData)) {
    if (jsonData.length === 0) {
      errors.push("Empty array provided");
      return { valid: false, errors };
    }

    let hasValidEntry = false;
    for (const entry of jsonData) {
      if (typeof entry === "object" && entry !== null) {
        if (entry.content || (entry.keys && Array.isArray(entry.keys) && entry.keys.length > 0)) {
          hasValidEntry = true;
          break;
        }
      }
    }

    if (!hasValidEntry) {
      errors.push("No valid entries found with content or keys");
      return { valid: false, errors };
    }

    return { valid: true, errors: [] };
  }

  if (jsonData.worldBook && Array.isArray(jsonData.worldBook)) {
    if (jsonData.worldBook.length === 0) {
      errors.push("Empty worldBook array provided");
      return { valid: false, errors };
    }

    return { valid: true, errors: [] };
  }

  const values = Object.values(jsonData);
  if (values.length === 0) {
    errors.push("No entries found in the provided data");
    return { valid: false, errors };
  }

  return { valid: true, errors: [] };
}
