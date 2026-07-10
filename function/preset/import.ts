import { PresetOperations } from "@/lib/data/preset-operation";

export async function importPresetFromJson(jsonContent: string, customName?: string): Promise<{ success: boolean; presetId?: string; error?: string }> {
  try {
    let presetData;
    try {
      presetData = JSON.parse(jsonContent);
    } catch (e) {
      return { success: false, error: "Invalid JSON format" };
    }

    if (!presetData || typeof presetData !== "object") {
      return { success: false, error: "Invalid preset structure" };
    }

    const presetId = await PresetOperations.importPreset(presetData, customName);
    
    if (!presetId) {
      return { success: false, error: "Failed to import preset" };
    }

    return { success: true, presetId };
  } catch (error) {
    console.error("Error importing preset from JSON:", error);
    return { success: false, error: `Error importing preset: ${error instanceof Error ? error.message : String(error)}` };
  }
}
