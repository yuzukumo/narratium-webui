import { WorldBookOperations } from "@/lib/data/world-book-operation";
import { WorldBookEntry } from "@/lib/models/world-book-model";
import { normalizeWorldBookEntry } from "@/lib/character-card/normalize";
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

    const entries = extractWorldBookEntries(jsonData);
    if (!entries) {
      result.errors.push("Unsupported JSON format");
      result.message = "Unsupported JSON format";
      return result;
    }

    for (const entryData of entries) {
      try {
        const entryId = `entry_${uuidv4()}`;
        
        const normalized = normalizeWorldBookEntry(entryData, result.importedCount);
        if (!normalized.content.trim() && normalized.keys.length === 0) {
          result.skippedCount++;
          continue;
        }
        const worldBookEntry: WorldBookEntry = {
          ...normalized,
          extensions: {
            ...normalized.extensions,
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
  if (!jsonData || typeof jsonData !== "object") {
    return { valid: false, errors: ["Invalid JSON: Root must be an object or array"] };
  }
  const entries = extractWorldBookEntries(jsonData);
  if (!entries || entries.length === 0) {
    return { valid: false, errors: ["No world-book entries found"] };
  }
  return entries.some(isWorldBookEntry)
    ? { valid: true, errors: [] }
    : { valid: false, errors: ["No valid entries found with content or keys"] };
}

function isWorldBookEntry(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  const keys = entry.keys ?? entry.key;
  const hasKeys = typeof keys === "string"
    ? keys.trim().length > 0
    : Array.isArray(keys) && keys.some((key) => typeof key === "string" && key.trim().length > 0);
  return (typeof entry.content === "string" && entry.content.trim().length > 0) || hasKeys;
}

function extractWorldBookEntries(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return null;
  if (isWorldBookEntry(value)) return [value];
  const source = value as Record<string, unknown>;
  for (const key of ["entries", "worldBook", "world_book"]) {
    const candidate = source[key];
    if (Array.isArray(candidate)) return candidate;
    if (candidate && typeof candidate === "object") return Object.values(candidate);
  }
  const directEntries = Object.values(source);
  return directEntries.some(isWorldBookEntry) ? directEntries : null;
}
