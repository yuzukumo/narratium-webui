import { PresetOperations } from "@/lib/data/preset-operation";
import { Preset } from "@/lib/models/preset-model";

export async function getAllPresets() {
  try {
    const presets = await PresetOperations.getAllPresets();
    return { success: true, data: presets };
  } catch (error) {
    console.error("Error getting presets:", error);
    return { success: false, error: "Failed to get presets" };
  }
}

export async function getPreset(presetId: string) {
  try {
    const preset = await PresetOperations.getPreset(presetId);
    if (!preset) {
      return { success: false, error: "Preset not found" };
    }
    return { success: true, data: preset };
  } catch (error) {
    console.error("Error getting preset:", error);
    return { success: false, error: "Failed to get preset" };
  }
}

export async function createPreset(preset: Preset) {
  try {
    const presetId = await PresetOperations.createPreset(preset);
    if (!presetId) {
      return { success: false, error: "Failed to create preset" };
    }
    return { success: true, data: { id: presetId } };
  } catch (error) {
    console.error("Error creating preset:", error);
    return { success: false, error: "Failed to create preset" };
  }
}

export async function deletePreset(presetId: string) {
  try {
    const success = await PresetOperations.deletePreset(presetId);
    if (!success) {
      return { success: false, error: "Failed to delete preset" };
    }
    return { success: true };
  } catch (error) {
    console.error("Error deleting preset:", error);
    return { success: false, error: "Failed to delete preset" };
  }
}

export async function togglePresetEnabled(presetId: string, enabled: boolean) {
  try {

    if (enabled) {
      const allPresets = await PresetOperations.getAllPresets();

      for (const preset of allPresets) {
        if (preset.id && preset.id !== presetId && preset.enabled !== false) {
          const disableSuccess = await PresetOperations.updatePreset(preset.id, { enabled: false });
          if (!disableSuccess) {
            console.warn(`Failed to disable preset ${preset.id} while enabling ${presetId}`);
          }
        }
      }
    }

    const success = await PresetOperations.updatePreset(presetId, { enabled });
    if (!success) {
      return { success: false, error: "Failed to toggle preset" };
    }
    
    return { success: true };
  } catch (error) {
    console.error("Error toggling preset:", error);
    return { success: false, error: "Failed to toggle preset" };
  }
}

export async function getPromptsForDisplay(presetId: string) {
  try {
    const prompts = await PresetOperations.getPromptsOrderedForDisplay(presetId);
    return { success: true, data: prompts };
  } catch (error) {
    console.error("Error getting prompts for display:", error);
    return { success: false, error: "Failed to get prompts for display" };
  }
}
