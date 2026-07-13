import { createContext, useContext } from "react";
import en from "./locales/en.json";
import zh from "./locales/zh.json";
import de from "./locales/de.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import ja from "./locales/ja.json";
import zhTW from "./locales/zh-TW.json";
import {
  DEFAULT_LANGUAGE,
  LANGUAGES,
  LANGUAGE_NATIVE_NAMES,
  Language,
  LanguagePreference,
  isLanguage,
  languageFromLocales,
} from "@/lib/i18n/languages";

export {
  DEFAULT_LANGUAGE,
  LANGUAGES,
  LANGUAGE_NATIVE_NAMES,
  isLanguage,
  languageFromLocales,
};
export type { Language, LanguagePreference };

export const LANGUAGE_PREFERENCE_KEY = "language";
export const PREFERENCES_CHANGED_EVENT = "narratium:preferences-changed";

type TranslationTree = { [key: string]: string | TranslationTree };

const TRANSLATIONS: Record<Language, TranslationTree> = {
  zh,
  "zh-TW": zhTW,
  en,
  fr,
  es,
  de,
  ja,
};

type LanguageContextType = {
  language: Language;
  languagePreference: LanguagePreference;
  setLanguagePreference: (preference: LanguagePreference) => void;
  t: (key: string) => string;
  fontClass: string;
  titleFontClass: string;
  serifFontClass: string;
};

export const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useLanguage must be used within a LanguageProvider");
  }
  return context;
};

export const getTranslation = (language: Language, key: string): string => {
  const resolve = (tree: TranslationTree): string | undefined => {
    let result: string | TranslationTree = tree;
    for (const part of key.split(".")) {
      if (typeof result === "string" || result[part] === undefined) {
        return undefined;
      }
      result = result[part];
    }
    return typeof result === "string" ? result : undefined;
  };

  return resolve(TRANSLATIONS[language]) ?? resolve(TRANSLATIONS.en) ?? key;
};

export const getClientLanguage = (): Language => {
  if (typeof window === "undefined") {
    return DEFAULT_LANGUAGE;
  }
  const locales = navigator.languages?.length > 0
    ? navigator.languages
    : [navigator.language];
  return languageFromLocales(locales);
};
