import { readData, writeData, PRESET_FILE } from "@/lib/data/local-storage";
import { Preset, PresetPrompt } from "@/lib/models/preset-model";

export class PresetOperations {
  static async getPresets(): Promise<Record<string, any>> {
    const presetsArray = await readData(PRESET_FILE);
    return presetsArray[0] || {};
  }

  private static async savePresets(presets: Record<string, any>): Promise<void> {
    await writeData(PRESET_FILE, [presets]);
  }

  static async getAllPresets(): Promise<Preset[]> {
    try {
      const presets = await this.getPresets();
      const presetList = Object.entries(presets)
        .filter(([key]) => !key.endsWith("_settings"))
        .map(([_, value]) => value as Preset);
      
      return presetList;
    } catch (error) {
      console.error("Error getting presets:", error);
      return [];
    }
  }

  static async getPreset(presetId: string): Promise<Preset | null> {
    try {
      const presets = await this.getPresets();
      return presets[presetId] as Preset || null;
    } catch (error) {
      console.error("Error getting preset:", error);
      return null;
    }
  }

  static async createPreset(preset: Preset): Promise<string | null> {
    try {
      const presets = await this.getPresets();
      const presetId = `preset_${Date.now()}`;
      
      const newPresetIsActive = preset.enabled !== false;

      const newPreset = {
        ...preset,
        id: presetId,
        enabled: newPresetIsActive,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      
      if (newPresetIsActive) {
        for (const existingPresetId in presets) {
          if (presets.hasOwnProperty(existingPresetId) && existingPresetId !== presetId) {
            if (presets[existingPresetId].enabled !== false) {
              presets[existingPresetId].enabled = false;
              presets[existingPresetId].updated_at = new Date().toISOString();
            }
          }
        }
      }
      
      presets[presetId] = newPreset;
      await this.savePresets(presets);
      
      return presetId;
    } catch (error) {
      console.error("Error creating preset:", error);
      return null;
    }
  }

  static async updatePreset(presetId: string, updates: Partial<Preset>): Promise<boolean> {
    try {
      const presets = await this.getPresets();
      
      if (!presets[presetId]) {
        return false;
      }
      
      presets[presetId] = {
        ...presets[presetId],
        ...updates,
        updated_at: new Date().toISOString(),
      };
      
      await this.savePresets(presets);
      return true;
    } catch (error) {
      console.error("Error updating preset:", error);
      return false;
    }
  }

  static async deletePreset(presetId: string): Promise<boolean> {
    try {
      const presets = await this.getPresets();
      
      if (!presets[presetId]) {
        return false;
      }
      
      delete presets[presetId];
      await this.savePresets(presets);
      
      return true;
    } catch (error) {
      console.error("Error deleting preset:", error);
      return false;
    }
  }

  static async importPreset(jsonData: string | object, customName?: string): Promise<string | null> {
    try {
      const presetData = typeof jsonData === "string" ? JSON.parse(jsonData) : jsonData;
      
      const newPreset: Preset = {
        name: customName || presetData.name || "Imported Preset",
        enabled: true,
        prompts: [],
      };

      const addedPrompts = new Map<string, PresetPrompt>();
      
      if (Array.isArray(presetData.prompts)) {
        presetData.prompts
          .filter((prompt: any) => prompt.identifier && prompt.name)
          .forEach((prompt: any) => {
            const newPrompt: PresetPrompt = {
              identifier: prompt.identifier,
              name: prompt.name,
              enabled: prompt.enabled !== false,
              marker: prompt.marker,
              role: prompt.role,
              content: prompt.content,
              forbid_overrides: prompt.forbid_overrides,
            };
            
            addedPrompts.set(prompt.identifier, newPrompt);
          });
      }
      
      if (Array.isArray(presetData.prompt_order)) {
        let groupId = 1;
        
        for (const orderItem of presetData.prompt_order) {
          if (Array.isArray(orderItem.order)) {
            orderItem.order.forEach((entry: any, index: number) => {
              let prompt = addedPrompts.get(entry.identifier);
              
              if (!prompt) {
                prompt = {
                  identifier: entry.identifier,
                  name: entry.identifier,
                  enabled: entry.enabled !== false,
                };
                addedPrompts.set(entry.identifier, prompt);
              }
              
              prompt.group_id = groupId;
              prompt.position = index;
              prompt.enabled = entry.enabled !== false;
            });
            
            groupId++;
          }
        }
      }
      
      newPreset.prompts = Array.from(addedPrompts.values());
      
      return this.createPreset(newPreset);
    } catch (error) {
      console.error("Error importing preset:", error);
      return null;
    }
  }

  static async getOrderedPrompts(presetId: string): Promise<PresetPrompt[]> {
    try {
      const preset = await this.getPreset(presetId);
      
      if (!preset || preset.enabled === false) {
        return [];
      }

      let targetGroupId = 2;
      let groupPrompts = preset.prompts.filter(
        prompt => Number(prompt.group_id) === targetGroupId,
      );
      
      if (groupPrompts.length === 0) {
        targetGroupId = 1;
        groupPrompts = preset.prompts.filter(
          prompt => Number(prompt.group_id) === targetGroupId,
        );
      }

      if (groupPrompts.length === 0) {
        return preset.prompts.filter(prompt => 
          !prompt.group_id && prompt.enabled !== false,
        );
      }
      
      const orderedPrompts = [...groupPrompts].sort(
        (a, b) => (a.position || 0) - (b.position || 0),
      );
      
      return orderedPrompts.filter(prompt => prompt.enabled !== false);
    } catch (error) {
      console.error("Error getting ordered prompts:", error);
      return [];
    }
  }

  static async getPromptsOrderedForDisplay(presetId: string): Promise<PresetPrompt[]> {
    try {
      const preset = await this.getPreset(presetId);
      
      if (!preset) {
        return [];
      }

      let targetGroupId = 2;
      let groupPrompts = preset.prompts.filter(
        prompt => Number(prompt.group_id) === targetGroupId,
      );
      
      if (groupPrompts.length === 0) {
        targetGroupId = 1;
        groupPrompts = preset.prompts.filter(
          prompt => Number(prompt.group_id) === targetGroupId,
        );
      }

      if (groupPrompts.length === 0) {
        return preset.prompts;
      }
      
      const orderedPrompts = [...groupPrompts].sort(
        (a, b) => (a.position || 0) - (b.position || 0),
      );
      
      return orderedPrompts;
    } catch (error) {
      console.error("Error getting ordered prompts for display:", error);
      return [];
    }
  }

  static async updateCharacterPrompt(
    presetId: string,
    characterId: string | number,
    promptData: {
      identifier: string;
      name: string;
      content?: string;
      enabled?: boolean;
      position?: number;
      [key: string]: any;
    },
  ): Promise<boolean> {
    try {
      const preset = await this.getPreset(presetId);
      
      if (!preset) {
        return false;
      }
      
      const groupPrompts = preset.prompts.filter(
        prompt => String(prompt.group_id) === String(characterId),
      );
      
      const existingIndex = groupPrompts.findIndex(
        prompt => prompt.identifier === promptData.identifier,
      );
      
      const updatedPrompt: PresetPrompt = {
        ...promptData,
        group_id: characterId,
        position: promptData.position !== undefined ? 
          promptData.position : 
          groupPrompts.length > 0 ? 
            Math.max(...groupPrompts.map(p => p.position || 0)) + 1 : 
            0,
      };
      
      const updatedPrompts = [...preset.prompts];
      
      if (existingIndex >= 0) {
        const globalIndex = updatedPrompts.findIndex(
          p => p.identifier === promptData.identifier && 
               String(p.group_id) === String(characterId),
        );
        
        if (globalIndex >= 0) {
          updatedPrompts[globalIndex] = updatedPrompt;
        }
      } else {
        updatedPrompts.push(updatedPrompt);
      }
      
      return this.updatePreset(presetId, { prompts: updatedPrompts });
    } catch (error) {
      console.error("Error updating character prompt:", error);
      return false;
    }
  }
}
