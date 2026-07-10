"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";

interface SoundContextType {
  soundEnabled: boolean;
  toggleSound: () => void;
}

const SoundContext = createContext<SoundContextType | undefined>(undefined);

export function useSoundContext() {
  const context = useContext(SoundContext);
  if (context === undefined) {
    throw new Error("useSoundContext must be used within a SoundProvider");
  }
  return context;
}

interface SoundProviderProps {
  children: ReactNode;
}

export function SoundProvider({ children }: SoundProviderProps) {
  const [soundEnabled, setSoundEnabled] = useState(true);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedSoundPreference = localStorage.getItem("soundEnabled");
      if (savedSoundPreference !== null) {
        setSoundEnabled(savedSoundPreference === "true");
      }
    }
  }, []);

  const toggleSound = () => {
    const newValue = !soundEnabled;
    setSoundEnabled(newValue);

    if (typeof window !== "undefined") {
      localStorage.setItem("soundEnabled", String(newValue));
    }
  };

  return (
    <SoundContext.Provider value={{ soundEnabled, toggleSound }}>
      {children}
    </SoundContext.Provider>
  );
}
