import { inheritDataRevision, readData, writeData, REGEX_SCRIPTS_FILE } from "@/lib/data/local-storage";
import { RegexScript } from "@/lib/models/regex-script-model";

export interface RegexScriptSettings {
  enabled: boolean;
  applyToPrompt: boolean;
  applyToResponse: boolean;
  metadata?: any;
}

const DEFAULT_SETTINGS: RegexScriptSettings = {
  enabled: true,
  applyToPrompt: true,
  applyToResponse: true,
};

export class RegexScriptOperations {
  private static async getRegexScriptStore(): Promise<Record<string, any>> {
    const scriptsArray = await readData(REGEX_SCRIPTS_FILE);
    if (scriptsArray[0]) {
      return scriptsArray[0];
    }
    const emptyScripts: Record<string, any> = {};
    inheritDataRevision(REGEX_SCRIPTS_FILE, scriptsArray, [emptyScripts]);
    return emptyScripts;
  }

  private static async saveRegexScriptStore(store: Record<string, any>): Promise<boolean> {
    await writeData(REGEX_SCRIPTS_FILE, [store]);
    return true;
  }

  static async getRegexScripts(ownerId: string): Promise<Record<string, RegexScript> | null> {
    const store = await this.getRegexScriptStore();
    return store[ownerId] as Record<string, RegexScript> || null;
  }

  static async updateRegexScript(
    ownerId: string,
    scriptId: string,
    updates: Partial<RegexScript>,
  ): Promise<boolean> {
    const scripts = await this.getRegexScripts(ownerId);
    
    if (!scripts || !scripts[scriptId]) {
      return false;
    }
    
    scripts[scriptId] = { ...scripts[scriptId], ...updates };
    
    return this.updateOwnerScripts(ownerId, scripts);
  }

  static async addRegexScript(
    ownerId: string,
    script: RegexScript,
  ): Promise<string | null> {
    const scripts = await this.getRegexScripts(ownerId) || {};

    const scriptId = `script_${Object.keys(scripts).length}_${Date.now().toString().slice(-4)}`;

    const newScript = {
      ...script,
      id: scriptId,
    };
    
    scripts[scriptId] = newScript;
    
    const success = await this.updateOwnerScripts(ownerId, scripts);
    return success ? scriptId : null;
  }

  static async deleteRegexScript(ownerId: string, scriptId: string): Promise<boolean> {
    const scripts = await this.getRegexScripts(ownerId);
    
    if (!scripts || !scripts[scriptId]) {
      return false;
    }
    
    delete scripts[scriptId];
    return this.updateOwnerScripts(ownerId, scripts);
  }

  private static async updateOwnerScripts(ownerId: string, scripts: Record<string, RegexScript>): Promise<boolean> {
    const store = await this.getRegexScriptStore();
    store[ownerId] = scripts;
    return this.saveRegexScriptStore(store);
  }

  static async updateRegexScripts(
    ownerId: string,
    regexScripts: Record<string, RegexScript> | RegexScript[],
  ): Promise<boolean> {
    const scriptStore = await this.getRegexScriptStore();
    
    const processScript = (script: RegexScript): RegexScript => {
      return {
        ...script,
        scriptKey: script.scriptKey || script.id || "script",
        disabled: script.disabled === true,
        scriptName: script.scriptName || "Unnamed Script",
        trimStrings: script.trimStrings || [],
        placement: Array.isArray(script.placement) ? script.placement : [2],
        markdownOnly: script.markdownOnly === true,
        promptOnly: script.promptOnly === true,
        runOnEdit: script.runOnEdit !== false,
        substituteRegex: Number(script.substituteRegex || 0),
        minDepth: typeof script.minDepth === "number" ? script.minDepth : null,
        maxDepth: typeof script.maxDepth === "number" ? script.maxDepth : null,
      } as RegexScript;
    };
    
    const scripts = Array.isArray(regexScripts)
      ? regexScripts.reduce((acc, script, i) => {
        if (!script.findRegex) {
          console.warn("Skipping invalid regex script", script);
          return acc;
        }
        const processedScript = processScript(script);
        return {
          ...acc,
          [`script_${i}`]: processedScript,
        };
      }, {} as Record<string, RegexScript>)
      : Object.fromEntries(
        Object.entries(regexScripts).map(([key, script]) => {
          if (!script.findRegex) {
            console.warn("Skipping invalid regex script", script);
            return [key, null];
          }
          const processedScript = processScript(script);
          return [key, processedScript];
        }).filter(([_, script]) => script !== null),
      );
    
    scriptStore[ownerId] = scripts;
    return this.saveRegexScriptStore(scriptStore);
  }

  static async deleteRegexScripts(ownerId: string): Promise<void> {
    const store = await this.getRegexScriptStore();
    delete store[ownerId];
    delete store[`${ownerId}_settings`];
    await this.saveRegexScriptStore(store);
  }

  static async getRegexScriptSettings(ownerId: string): Promise<RegexScriptSettings> {
    const store = await this.getRegexScriptStore();
    const settings = store[`${ownerId}_settings`] as RegexScriptSettings;
    
    if (!settings) {
      return { ...DEFAULT_SETTINGS };
    }
    
    return {
      ...DEFAULT_SETTINGS,
      ...settings,
    };
  }

  static async updateRegexScriptSettings(
    ownerId: string,
    updates: Partial<RegexScriptSettings>,
  ): Promise<RegexScriptSettings> {
    const store = await this.getRegexScriptStore();
    const currentSettings = {
      ...DEFAULT_SETTINGS,
      ...(store[`${ownerId}_settings`] as RegexScriptSettings | undefined),
    };
    const newSettings = { ...currentSettings, ...updates };
    
    store[`${ownerId}_settings`] = newSettings;
    await this.saveRegexScriptStore(store);
    
    return newSettings;
  }

  static async getAllScriptsForProcessing(
    ownerId: string,
  ): Promise<RegexScript[]> {
    const ownerScripts = await this.getRegexScripts(ownerId) || {};
    const globalScripts = await this.getRegexScripts("global") || {};

    const allScripts: RegexScript[] = [
      ...Object.values(ownerScripts),
      ...Object.values(globalScripts),
    ];
    
    return allScripts;
  }

}
