import extract from "png-chunks-extract";
import encode from "png-chunks-encode";
import PNGtext from "png-chunk-text";
import { unzip } from "fflate";

const MAX_CHARX_BYTES = 256 * 1024 * 1024;
const MAX_CHARX_EXPANDED_BYTES = 512 * 1024 * 1024;
const MAX_CHARX_ENTRY_BYTES = 128 * 1024 * 1024;
const MAX_CARD_JSON_BYTES = 8 * 1024 * 1024;

export interface CharacterAsset {
  sourcePath: string;
  type: string;
  name: string;
  extension: string;
  blob: Blob;
  isIcon: boolean;
}

export interface ParsedCharacterBundle {
  data: string;
  image?: Blob;
  imageExtension?: string;
  assets: CharacterAsset[];
}

const encodeBase64 = (str: string): string => {
  const utf8Bytes = new TextEncoder().encode(str);
  let binary = "";
  for (let offset = 0; offset < utf8Bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...utf8Bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
};

const decodeBase64 = (b64: string): string => {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
};

export const writeCharacterToPng = async (file: File, data: string): Promise<Blob> => {
  const buffer = new Uint8Array(await file.arrayBuffer());
  const chunks = extract(buffer);

  const filteredChunks = chunks.filter(chunk => {
    if (chunk.name !== "tEXt") return true;
    const { keyword } = PNGtext.decode(chunk.data);
    return !["chara", "ccv3"].includes(keyword.toLowerCase());
  });

  const base64Data = encodeBase64(data);
  filteredChunks.splice(-1, 0, PNGtext.encode("chara", base64Data));

  try {
    const v3Data = JSON.parse(data);
    v3Data.spec = "chara_card_v3";
    v3Data.spec_version = "3.0";
    const base64V3 = encodeBase64(JSON.stringify(v3Data));
    filteredChunks.splice(-1, 0, PNGtext.encode("ccv3", base64V3));
  } catch (err) {
    console.warn("Failed to add ccv3 chunk:", err);
  }

  const newBuffer = encode(filteredChunks);
  const pngBuffer = new ArrayBuffer(newBuffer.byteLength);
  new Uint8Array(pngBuffer).set(newBuffer);
  return new Blob([pngBuffer], { type: "image/png" });
};

export const readCharacterFromPng = async (file: File): Promise<string> => {
  const buffer = new Uint8Array(await file.arrayBuffer());
  const chunks = extract(buffer);

  const textChunks = chunks
    .filter(chunk => chunk.name === "tEXt")
    .map(chunk => PNGtext.decode(chunk.data));

  const ccv3 = textChunks.find(c => c.keyword.toLowerCase() === "ccv3");
  const chara = textChunks.find(c => c.keyword.toLowerCase() === "chara");

  const raw = ccv3?.text || chara?.text;
  if (!raw) throw new Error("No PNG metadata found.");

  return decodeBase64(raw);
};

export const parseCharacterCard = async (file: File): Promise<string> => {
  const name = file.name.toLowerCase();
  if (name.endsWith(".json")) {
    const json = await file.text();
    JSON.parse(json);
    return json;
  }
  if (!name.endsWith(".png")) {
    throw new Error("Unsupported format. Use a SillyTavern PNG or JSON character card.");
  }
  return readCharacterFromPng(file);
};

function zipPayload(bytes: Uint8Array): Uint8Array {
  const offset = bytes.findIndex((value, index) => (
    value === 0x50
    && bytes[index + 1] === 0x4b
    && bytes[index + 2] === 0x03
    && bytes[index + 3] === 0x04
  ));
  if (offset < 0) throw new Error("Invalid CharX archive.");
  return bytes.subarray(offset);
}

function normalizeArchivePath(value: string): string {
  let decoded = value.trim().replaceAll("\\", "/");
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    throw new Error("CharX contains an invalid asset path.");
  }
  if (
    !decoded
    || decoded.includes("\0")
    || decoded.startsWith("/")
    || /^[a-z]:/i.test(decoded)
    || decoded.split("/").some((segment) => segment === "..")
  ) {
    throw new Error("CharX contains an unsafe asset path.");
  }
  return decoded.replace(/^\.\//, "").replace(/\/{2,}/g, "/");
}

function embeddedAssetPath(uri: unknown): string | null {
  if (typeof uri !== "string") return null;
  const match = uri.trim().match(/^(?:embed(?:ded|ed):\/\/|__asset:)(.+)$/i);
  return match ? normalizeArchivePath(match[1]) : null;
}

function normalizedExtension(value: unknown, path: string): string {
  const explicit = typeof value === "string" ? value.trim().replace(/^\./, "").toLowerCase() : "";
  const fallback = path.includes(".") ? path.slice(path.lastIndexOf(".") + 1).toLowerCase() : "";
  return explicit || fallback;
}

function contentType(extension: string): string {
  return ({
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    apng: "image/apng",
    avif: "image/avif",
    bmp: "image/bmp",
    jfif: "image/jpeg",
    svg: "image/svg+xml",
    json: "application/json",
    txt: "text/plain",
  } as Record<string, string>)[extension] || "application/octet-stream";
}

function extractZipFiles(bytes: Uint8Array, wantedPaths: Set<string>): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    let expandedBytes = 0;
    try {
      unzip(zipPayload(bytes), {
        filter: (entry) => {
          const path = normalizeArchivePath(entry.name);
          if (!wantedPaths.has(path)) return false;
          if (entry.originalSize > MAX_CHARX_ENTRY_BYTES) {
            throw new Error(`CharX entry is too large: ${path}`);
          }
          expandedBytes += entry.originalSize;
          if (expandedBytes > MAX_CHARX_EXPANDED_BYTES) {
            throw new Error("CharX expanded data is too large.");
          }
          return true;
        },
      }, (error, extracted) => {
        if (error) {
          reject(error);
          return;
        }
        try {
          resolve(Object.fromEntries(Object.entries(extracted).map(([path, payload]) => [
            normalizeArchivePath(path),
            payload,
          ])));
        } catch (parseError) {
          reject(parseError);
        }
      });
    } catch (error) {
      reject(error);
    }
  });
}

async function parseCharX(file: File): Promise<ParsedCharacterBundle> {
  if (file.size > MAX_CHARX_BYTES) throw new Error("CharX archive is too large.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const cardFiles = await extractZipFiles(bytes, new Set(["card.json"]));
  const cardBytes = cardFiles["card.json"];
  if (!cardBytes) throw new Error("CharX is missing card.json.");
  if (cardBytes.byteLength > MAX_CARD_JSON_BYTES) throw new Error("CharX card.json is too large.");

  const data = new TextDecoder("utf-8", { fatal: true }).decode(cardBytes);
  const card = JSON.parse(data) as { spec?: unknown; data?: { assets?: unknown } };
  if (typeof card.spec !== "string" || !card.data || typeof card.data !== "object") {
    throw new Error("Invalid CharX character card.");
  }

  const definitions = Array.isArray(card.data.assets) ? card.data.assets : [];
  const referenced = definitions.flatMap((asset) => {
    if (!asset || typeof asset !== "object") return [];
    const source = asset as Record<string, unknown>;
    const path = embeddedAssetPath(source.uri);
    return path ? [{ source, path }] : [];
  });
  const extracted = await extractZipFiles(bytes, new Set(referenced.map(({ path }) => path)));
  const assets = referenced.flatMap(({ source, path }, index): CharacterAsset[] => {
    const payload = extracted[path];
    if (!payload) return [];
    const extension = normalizedExtension(source.ext, path);
    const type = typeof source.type === "string" ? source.type.toLowerCase() : "";
    const name = typeof source.name === "string" ? source.name : `asset-${index}`;
    const copy = new Uint8Array(payload.byteLength);
    copy.set(payload);
    return [{
      sourcePath: path,
      type,
      name,
      extension,
      blob: new Blob([copy], { type: contentType(extension) }),
      isIcon: type === "icon",
    }];
  });
  const icons = assets.filter((asset) => asset.isIcon && asset.blob.type.startsWith("image/"));
  const icon = icons.find((asset) => asset.name.toLowerCase() === "main") || icons[0];
  return {
    data,
    image: icon?.blob,
    imageExtension: icon?.extension,
    assets,
  };
}

export async function parseCharacterBundle(file: File): Promise<ParsedCharacterBundle> {
  if (file.name.toLowerCase().endsWith(".charx")) return parseCharX(file);
  return {
    data: await parseCharacterCard(file),
    image: file.name.toLowerCase().endsWith(".png") ? file : undefined,
    imageExtension: file.name.toLowerCase().endsWith(".png") ? "png" : undefined,
    assets: [],
  };
}
