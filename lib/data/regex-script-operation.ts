import { readData, writeData, REGEX_SCRIPTS_FILE } from "@/lib/data/local-storage";
import { RegexScript } from "@/lib/models/regex-script-model";

export interface RegexScriptSettings {
  enabled: boolean;
  applyToPrompt: boolean;
  applyToResponse: boolean;
  metadata?: any;
}

const DEFAULT_SETTINGS: RegexScriptSettings = {
  enabled: true,
  applyToPrompt: false,
  applyToResponse: true,
};

export class RegexScriptOperations {
  private static async getRegexScriptStore(): Promise<Record<string, any>> {
    try {
      const scriptsArray = await readData(REGEX_SCRIPTS_FILE);
      return scriptsArray[0] || {};
    } catch (error) {
      console.error("Error reading regex scripts:", error);
      return {};
    }
  }

  private static async saveRegexScriptStore(store: Record<string, any>): Promise<boolean> {
    try {
      await writeData(REGEX_SCRIPTS_FILE, [store]);
      return true;
    } catch (error) {
      console.error("Error saving regex scripts:", error);
      return false;
    }
  }

  static async getRegexScripts(ownerId: string): Promise<Record<string, RegexScript> | null> {
    try {
      const store = await this.getRegexScriptStore();
      return store[ownerId] as Record<string, RegexScript> || null;
    } catch (error) {
      console.error("Error getting regex scripts:", error);
      return null;
    }
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
        disabled: script.disabled || false,
        scriptName: script.scriptName || "Unnamed Script",
        trimStrings: script.trimStrings || [],
        placement: script.placement || [999],
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
    await this.saveRegexScriptStore(scriptStore);
    return true;
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
    const currentSettings = await this.getRegexScriptSettings(ownerId);
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
