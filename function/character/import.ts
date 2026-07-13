import { parseCharacterBundle } from "@/utils/character-parser";
import {
  LocalCharacterRecordOperations,
  normalizeProtagonistName,
} from "@/lib/data/character-record-operation";
import { deleteBlob, setBlob } from "@/lib/data/local-storage";
import { WorldBookOperations } from "@/lib/data/world-book-operation";
import { RegexScriptOperations } from "@/lib/data/regex-script-operation";
import { RegexScript } from "@/lib/models/regex-script-model";
import { v4 as uuidv4 } from "uuid";
import { embeddedRegexScripts, normalizeCharacterCard } from "@/lib/character-card/normalize";

export async function handleCharacterUpload(
  file: File,
  options: { protagonistName: string; trustEmbeddedRegex?: boolean },
) {
  const fileName = file?.name.toLowerCase() || "";
  const isPng = fileName.endsWith(".png");
  const isJson = fileName.endsWith(".json");
  const isCharX = fileName.endsWith(".charx");
  if (!file || (!isPng && !isJson && !isCharX)) {
    throw new Error("Unsupported or missing file.");
  }
  const protagonistName = normalizeProtagonistName(options.protagonistName);

  try {
    const bundle = await parseCharacterBundle(file);
    const characterJson = normalizeCharacterCard(JSON.parse(bundle.data));

    const characterId = `char_${uuidv4()}`;
    const imagePath = bundle.image
      ? `${characterId}.${bundle.imageExtension || "bin"}`
      : "";
    const assetPaths = bundle.assets.map((asset, index) => {
      if (imagePath && asset.blob === bundle.image) return imagePath;
      const leaf = asset.sourcePath.split("/").at(-1)?.replace(/[^a-zA-Z0-9._-]/g, "_") || `asset-${index}`;
      return `characters/${characterId}/assets/${index}-${leaf}`;
    });
    if (bundle.assets.length > 0) {
      characterJson.data.extensions = {
        ...characterJson.data.extensions,
        narratium_charx_assets: bundle.assets.map((asset, index) => ({
          source_path: asset.sourcePath,
          blob_key: assetPaths[index],
          type: asset.type,
          name: asset.name,
          extension: asset.extension,
        })),
      };
    }
    const worldBookEntries = characterJson.data.character_book?.entries;
    const regexScripts = embeddedRegexScripts(characterJson).map((script) => ({
      ...script,
      scriptKey: typeof script.scriptKey === "string" && script.scriptKey
        ? script.scriptKey
        : `script_${uuidv4()}`,
      disabled: options.trustEmbeddedRegex !== true || script.disabled === true,
      extensions: {
        ...(script.extensions && typeof script.extensions === "object" ? script.extensions : {}),
        imported: true,
        importedAt: Date.now(),
        trusted: options.trustEmbeddedRegex === true,
      },
    })) as RegexScript[];

    try {
      await LocalCharacterRecordOperations.createCharacter(
        characterId,
        characterJson,
        imagePath,
        protagonistName,
      );
      if (bundle.image && imagePath) {
        await setBlob(imagePath, bundle.image);
      }
      for (let index = 0; index < bundle.assets.length; index += 1) {
        if (assetPaths[index] === imagePath) continue;
        await setBlob(assetPaths[index], bundle.assets[index].blob);
      }
      if (worldBookEntries) {
        await WorldBookOperations.updateWorldBook(characterId, worldBookEntries);
      }
      if (regexScripts.length > 0) {
        await RegexScriptOperations.updateRegexScripts(characterId, regexScripts);
        await RegexScriptOperations.updateRegexScriptSettings(characterId, {
          enabled: true,
          applyToPrompt: true,
          applyToResponse: true,
        });
      }
    } catch (error) {
      await Promise.allSettled([
        LocalCharacterRecordOperations.deleteCharacter(characterId),
        WorldBookOperations.deleteWorldBook(characterId),
        RegexScriptOperations.deleteRegexScripts(characterId),
        ...(imagePath ? [deleteBlob(imagePath)] : []),
        ...[...new Set(assetPaths)].filter((path) => path !== imagePath).map((path) => deleteBlob(path)),
      ]);
      throw error;
    }

    return {
      success: true,
      characterId,
      characterData: characterJson,
      imagePath,
      hasWorldBook: !!worldBookEntries,
      hasRegexScripts: regexScripts.length > 0,
      embeddedRegexScriptsDisabled: regexScripts.length > 0 && options.trustEmbeddedRegex !== true,
    };
  } catch (error: any) {
    console.error("Failed to parse character data:", error);
    throw new Error(`Failed to parse character data: ${error.message}`);
  }
}
