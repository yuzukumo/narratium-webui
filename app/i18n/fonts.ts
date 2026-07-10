import { Language } from "./index";

export const languageFontMap: Record<Language, string> = {
  "zh": "font-noto-sans-sc",
  "en": "font-source-sans",
};

export const languageSerifFontMap: Record<Language, string> = {
  "zh": "font-noto-serif-sc",
  "en": "font-source-serif",
};

export const languageTitleFontMap: Record<Language, string> = {
  "zh": "font-noto-serif-sc",
  "en": "font-cinzel",
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
