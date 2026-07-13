import { Language } from "./index";

export const languageFontMap: Record<Language, string> = {
  "zh": "font-noto-sans-sc",
  "zh-TW": "font-noto-sans-sc",
  "en": "font-source-sans",
  "fr": "font-source-sans",
  "es": "font-source-sans",
  "de": "font-source-sans",
  "ja": "font-noto-sans-sc",
};

export const languageSerifFontMap: Record<Language, string> = {
  "zh": "font-noto-serif-sc",
  "zh-TW": "font-noto-serif-sc",
  "en": "font-source-serif",
  "fr": "font-source-serif",
  "es": "font-source-serif",
  "de": "font-source-serif",
  "ja": "font-noto-serif-sc",
};

export const languageTitleFontMap: Record<Language, string> = {
  "zh": "font-noto-serif-sc",
  "zh-TW": "font-noto-serif-sc",
  "en": "font-cinzel",
  "fr": "font-cinzel",
  "es": "font-cinzel",
  "de": "font-cinzel",
  "ja": "font-noto-serif-sc",
};

export const getLanguageFont = (language: Language): string => {
  return languageFontMap[language] || "font-source-sans";
};

export const getLanguageSerifFont = (language: Language): string => {
  return languageSerifFontMap[language] || "font-source-serif";
};

export const getLanguageTitleFont = (language: Language): string => {
  return languageTitleFontMap[language] || "font-cinzel";
};

export const fontClass = "font-sans";
export const serifFontClass = "font-serif";
export const titleFontClass = "font-title";
