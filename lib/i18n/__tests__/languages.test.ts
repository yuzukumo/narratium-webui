import { describe, expect, it } from "vitest";
import de from "@/app/i18n/locales/de.json";
import en from "@/app/i18n/locales/en.json";
import es from "@/app/i18n/locales/es.json";
import fr from "@/app/i18n/locales/fr.json";
import ja from "@/app/i18n/locales/ja.json";
import zh from "@/app/i18n/locales/zh.json";
import zhTW from "@/app/i18n/locales/zh-TW.json";
import {
  LANGUAGES,
  LANGUAGE_NATIVE_NAMES,
  languageFromLocales,
} from "@/lib/i18n/languages";

type TranslationTree = { [key: string]: string | TranslationTree };

function flatten(tree: TranslationTree, prefix = "", output: Record<string, string> = {}) {
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") output[path] = value;
    else flatten(value, path, output);
  }
  return output;
}

const localeTrees = { de, en, es, fr, ja, zh, "zh-TW": zhTW } as const;
const protectedTokenPattern = /{{[^{}]+}}|{[^{}]+}|<\/?[A-Za-z][^>]*>|https?:\/\/[^\s)\]}]+|`[^`]+`|\$\d+/g;

describe("supported languages", () => {
  it("resolves browser locale preferences, including Traditional Chinese variants", () => {
    expect(languageFromLocales(["zh-TW"])).toBe("zh-TW");
    expect(languageFromLocales(["zh-Hant-HK"])).toBe("zh-TW");
    expect(languageFromLocales(["zh-HK"])).toBe("zh-TW");
    expect(languageFromLocales(["zh-CN"])).toBe("zh");
    expect(languageFromLocales(["fr-CA", "en-US"])).toBe("fr");
    expect(languageFromLocales(["pt-BR", "ja-JP"])).toBe("ja");
    expect(languageFromLocales(["pt-BR"])).toBe("zh");
  });

  it("has a native display name for every language option", () => {
    expect(Object.keys(LANGUAGE_NATIVE_NAMES)).toEqual([...LANGUAGES]);
    expect(Object.values(LANGUAGE_NATIVE_NAMES).every(Boolean)).toBe(true);
  });
});

describe("translation catalogs", () => {
  const english = flatten(en);

  it.each(Object.entries(localeTrees))("keeps %s structurally aligned with English", (_name, tree) => {
    const translated = flatten(tree);
    expect(Object.keys(translated).sort()).toEqual(Object.keys(english).sort());
    expect(Object.values(translated).every((value) => value.trim().length > 0)).toBe(true);
  });

  it.each(Object.entries(localeTrees).filter(([name]) => name !== "en"))(
    "preserves protected tokens in %s",
    (_name, tree) => {
      const translated = flatten(tree);
      for (const [key, source] of Object.entries(english)) {
        const sourceTokens = (source.match(protectedTokenPattern) || []).sort();
        const translatedTokens = (translated[key].match(protectedTokenPattern) || []).sort();
        expect(translatedTokens, key).toEqual(sourceTokens);
        expect(translated[key], key).not.toContain("NARRATIUMTOKEN");
      }
    },
  );
});
