import { RegexScriptOperations } from "@/lib/data/regex-script-operation";
import { RegexScript } from "@/lib/models/regex-script-model";

export interface GlobalRegexScript {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
  scriptCount: number;
  sourceCharacterId?: string;
  sourceCharacterName?: string;
}

export interface GlobalRegexScriptResult {
  success: boolean;
  message: string;
  globalId?: string;
  regexScript?: GlobalRegexScript;
}

export interface ListGlobalRegexScriptsResult {
  success: boolean;
  globalRegexScripts: GlobalRegexScript[];
  message?: string;
}

export async function getNextGlobalId(): Promise<string> {
  try {
    const result = await listGlobalRegexScripts();
    if (!result.success) {
      return "global_regex_1";
    }

    const existingIds = result.globalRegexScripts.map(script => {
      const match = script.id.match(/^global_regex_(\d+)$/);
      return match ? parseInt(match[1], 10) : 0;
    });

    const maxId = existingIds.length > 0 ? Math.max(...existingIds) : 0;
    return `global_regex_${maxId + 1}`;
  } catch (error) {
    console.error("Failed to get next global ID:", error);
    return "global_regex_1";
  }
}

export async function listGlobalRegexScripts(): Promise<ListGlobalRegexScriptsResult> {
  try {
    const globalRegexScripts: GlobalRegexScript[] = [];
    const store = await RegexScriptOperations["getRegexScriptStore"]();
    
    for (const key of Object.keys(store)) {
      if (key.startsWith("global_regex_") && key.endsWith("_settings")) {
        const settings = store[key];
        
        if (settings && settings.metadata) {
          globalRegexScripts.push(settings.metadata as GlobalRegexScript);
        }
      }
    }

    globalRegexScripts.sort((a, b) => b.createdAt - a.createdAt);

    return {
      success: true,
      globalRegexScripts,
    };
  } catch (error: any) {
    console.error("Failed to list global regex scripts:", error);
    return {
      success: false,
      globalRegexScripts: [],
      message: `Failed to list global regex scripts: ${error.message}`,
    };
  }
}

export async function getGlobalRegexScript(globalId: string): Promise<{
  success: boolean;
  scripts?: Record<string, RegexScript>;
  metadata?: GlobalRegexScript;
  message?: string;
}> {
  try {
    if (!globalId.startsWith("global_regex_")) {
      return {
        success: false,
        message: "Invalid global regex script ID",
      };
    }

    const scripts = await RegexScriptOperations.getRegexScripts(globalId);
    const settings = await RegexScriptOperations.getRegexScriptSettings(globalId);

    if (!scripts || !settings?.metadata) {
      return {
        success: false,
        message: "Global regex script not found",
      };
    }

    return {
      success: true,
      scripts,
      metadata: settings.metadata as GlobalRegexScript,
    };
  } catch (error: any) {
    console.error("Failed to get global regex script:", error);
    return {
      success: false,
      message: `Failed to get global regex script: ${error.message}`,
    };
  }
}

export async function importFromGlobalRegexScript(
  characterId: string,
  globalId: string,
): Promise<{
  success: boolean;
  message: string;
  importedCount: number;
}> {
  try {
    const globalResult = await getGlobalRegexScript(globalId);
    if (!globalResult.success || !globalResult.scripts) {
      return {
        success: false,
        message: globalResult.message || "Failed to load global regex script",
        importedCount: 0,
      };
    }

    const characterScripts = await RegexScriptOperations.getRegexScripts(characterId) || {};
    let importedCount = 0;
    const now = Date.now();

    for (const [scriptId, script] of Object.entries(globalResult.scripts)) {
      const newScriptId = `script_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      characterScripts[newScriptId] = {
        ...script,
        scriptKey: newScriptId,
        extensions: {
          imported: true,
          importedAt: now,
          globalSource: true,
          globalSourceId: globalId,
          globalSourceName: globalResult.metadata?.name,
        },
      };
      importedCount++;
    }

    const saveResult = await RegexScriptOperations.updateRegexScripts(characterId, characterScripts);
    if (!saveResult) {
      return {
        success: false,
        message: "Failed to save imported scripts",
        importedCount: 0,
      };
    }

    return {
      success: true,
      message: `Successfully imported ${importedCount} scripts from global regex script "${globalResult.metadata?.name}"`,
      importedCount,
    };
  } catch (error: any) {
    console.error("Failed to import from global regex script:", error);
    return {
      success: false,
      message: `Failed to import from global regex script: ${error.message}`,
      importedCount: 0,
    };
  }
}

export async function deleteGlobalRegexScript(globalId: string): Promise<{
  success: boolean;
  message: string;
}> {
  try {
    if (!globalId.startsWith("global_regex_")) {
      return {
        success: false,
        message: "Invalid global regex script ID",
      };
    }

    const store = await RegexScriptOperations["getRegexScriptStore"]();
    
    delete store[globalId];
    
    delete store[`${globalId}_settings`];
    
    await RegexScriptOperations["saveRegexScriptStore"](store);

    return {
      success: true,
      message: "Global regex script deleted successfully",
    };
  } catch (error: any) {
    console.error("Failed to delete global regex script:", error);
    return {
      success: false,
      message: `Failed to delete global regex script: ${error.message}`,
    };
  }
} 
