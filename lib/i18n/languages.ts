export const LANGUAGES = ["zh", "zh-TW", "en", "fr", "es", "de", "ja"] as const;

export type Language = typeof LANGUAGES[number];
export type LanguagePreference = Language | null;

export const DEFAULT_LANGUAGE: Language = "zh";

export const LANGUAGE_NATIVE_NAMES: Record<Language, string> = {
  zh: "简体中文",
  "zh-TW": "繁體中文（台灣）",
  en: "English",
  fr: "Français",
  es: "Español",
  de: "Deutsch",
  ja: "日本語",
};

export const LANGUAGE_LOCALES: Record<Language, string> = {
  zh: "zh-CN",
  "zh-TW": "zh-TW",
  en: "en-US",
  fr: "fr-FR",
  es: "es-ES",
  de: "de-DE",
  ja: "ja-JP",
};

export const isLanguage = (value: string | null): value is Language => (
  value !== null && LANGUAGES.includes(value as Language)
);

export const defaultProtagonistName = (language: Language): string => {
  switch (language) {
  case "zh":
  case "zh-TW":
    return "我";
  case "fr":
    return "je";
  case "es":
    return "yo";
  case "de":
    return "ich";
  case "ja":
    return "私";
  default:
    return "I";
  }
};

export const languageFromLocales = (locales: readonly string[]): Language => {
  for (const rawLocale of locales) {
    const locale = rawLocale.trim().toLowerCase().replaceAll("_", "-");
    if (!locale) {
      continue;
    }
    if (locale === "zh-tw" || locale === "zh-hk" || locale === "zh-mo"
      || locale.startsWith("zh-hant")) {
      return "zh-TW";
    }
    const base = locale.split("-")[0];
    if (base === "zh") {
      return "zh";
    }
    if (isLanguage(base)) {
      return base;
    }
  }
  return DEFAULT_LANGUAGE;
};
