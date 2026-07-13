"use client";

import { ReactNode, useCallback, useEffect, useState } from "react";
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_PREFERENCE_KEY,
  Language,
  LanguageContext,
  LanguagePreference,
  PREFERENCES_CHANGED_EVENT,
  getTranslation,
  getClientLanguage,
  isLanguage,
} from "./index";
import { getLanguageFont, getLanguageTitleFont, getLanguageSerifFont } from "./fonts";

interface LanguageProviderProps {
  children: ReactNode;
}

export function LanguageProvider({ children }: LanguageProviderProps) {
  const [language, setLanguageState] = useState<Language>(DEFAULT_LANGUAGE);
  const [languagePreference, setLanguagePreferenceState] = useState<LanguagePreference>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [fontClass, setFontClass] = useState(getLanguageFont(DEFAULT_LANGUAGE));
  const [titleFontClass, setTitleFontClass] = useState(getLanguageTitleFont(DEFAULT_LANGUAGE));
  const [serifFontClass, setSerifFontClass] = useState(getLanguageSerifFont(DEFAULT_LANGUAGE));

  const applyLanguage = useCallback((nextLanguage: Language) => {
    setLanguageState(nextLanguage);
    setFontClass(getLanguageFont(nextLanguage));
    setTitleFontClass(getLanguageTitleFont(nextLanguage));
    setSerifFontClass(getLanguageSerifFont(nextLanguage));
    document.documentElement.lang = nextLanguage;
  }, []);

  const synchronizePreference = useCallback(() => {
    const storedPreference = window.localStorage.getItem(LANGUAGE_PREFERENCE_KEY);
    const nextPreference = isLanguage(storedPreference) ? storedPreference : null;
    setLanguagePreferenceState(nextPreference);
    applyLanguage(nextPreference ?? getClientLanguage());
  }, [applyLanguage]);

  useEffect(() => {
    const synchronizeBrowserLanguage = () => {
      if (!isLanguage(window.localStorage.getItem(LANGUAGE_PREFERENCE_KEY))) {
        applyLanguage(getClientLanguage());
      }
    };
    const synchronizeStorage = (event: StorageEvent) => {
      if (event.storageArea === window.localStorage && (
        event.key === null || event.key === LANGUAGE_PREFERENCE_KEY
      )) {
        synchronizePreference();
      }
    };

    synchronizePreference();
    setIsLoaded(true);

    window.addEventListener("languagechange", synchronizeBrowserLanguage);
    window.addEventListener("storage", synchronizeStorage);
    window.addEventListener(PREFERENCES_CHANGED_EVENT, synchronizePreference);
    return () => {
      window.removeEventListener("languagechange", synchronizeBrowserLanguage);
      window.removeEventListener("storage", synchronizeStorage);
      window.removeEventListener(PREFERENCES_CHANGED_EVENT, synchronizePreference);
    };
  }, [applyLanguage, synchronizePreference]);

  const setLanguagePreference = useCallback((preference: LanguagePreference) => {
    if (preference === null) {
      window.localStorage.removeItem(LANGUAGE_PREFERENCE_KEY);
    } else {
      window.localStorage.setItem(LANGUAGE_PREFERENCE_KEY, preference);
    }
    setLanguagePreferenceState(preference);
    applyLanguage(preference ?? getClientLanguage());
  }, [applyLanguage]);

  const t = useCallback((key: string) => {
    return getTranslation(language, key);
  }, [language]);

  if (!isLoaded) {
    return <div className="h-full bg-[#1a1816]" aria-hidden="true" />;
  }

  return (
    <LanguageContext.Provider value={{
      language,
      languagePreference,
      setLanguagePreference,
      t,
      fontClass,
      titleFontClass,
      serifFontClass,
    }}>
      {children}
    </LanguageContext.Provider>
  );
}
