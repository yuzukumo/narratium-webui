import { useState, useEffect } from "react";
import { useLanguage } from "@/app/i18n";

export interface TourStep {
  target: string;
  title: string;
  content: string;
  position: "top" | "bottom" | "left" | "right";
  allowSkip?: boolean;
  isLanguageSelection?: boolean;
}

const TOUR_STORAGE_KEY = "narratium_tour_completed";
const CHARACTER_TOUR_STORAGE_KEY = "narratium_character_tour_completed";

export function useTour() {
  const [isTourVisible, setIsTourVisible] = useState(false);
  const [currentTourSteps, setCurrentTourSteps] = useState<TourStep[]>([]);
  const { t, language } = useLanguage();

  useEffect(() => {
    const tourCompleted = localStorage.getItem(TOUR_STORAGE_KEY);
    if (!tourCompleted) {
      setTimeout(() => {
        startHomeTour();
      }, 2000);
    }
  }, []);

  useEffect(() => {
    if (isTourVisible) {
      const isHomeTour = currentTourSteps.length > 0 && currentTourSteps[0].target === "body";
      const isCharacterTour = !isHomeTour;

      if (isHomeTour) {
        startHomeTour();
      } else if (isCharacterTour) {
        startCharacterTour();
      }
    }
  }, [language]);

  const startHomeTour = () => {
    const homeSteps: TourStep[] = [
      {
        target: "body",
        title: "选择语言 | Choose Your Language",
        content: "请选择您偏好的语言 | Please select your preferred language",
        position: "bottom",
        allowSkip: false,
        isLanguageSelection: true,
      },
      {
        target: "body",
        title: t("tour.welcome"),
        content: t("tour.welcomeDescription"),
        position: "bottom",
      },
      {
        target: "[data-tour='login-button']",
        title: t("tour.loginTitle"),
        content: t("tour.loginDescription"),
        position: "top",
      },
      {
        target: "[data-tour='settings-button']",
        title: t("tour.settingsTitle"),
        content: t("tour.settingsDescription"),
        position: "bottom",
      },
    ];
    
    setCurrentTourSteps(homeSteps);
    setIsTourVisible(true);
  };

  const startCharacterTour = () => {
    const characterTourCompleted = localStorage.getItem(CHARACTER_TOUR_STORAGE_KEY);
    if (characterTourCompleted) {
      return;
    }

    const characterSteps: TourStep[] = [
      {
        target: "[data-tour='worldbook-button']",
        title: t("tour.worldbookTitle"),
        content: t("tour.worldbookDescription"),
        position: "bottom",
      },
      {
        target: "[data-tour='regex-button']",
        title: t("tour.regexTitle"),
        content: t("tour.regexDescription"),
        position: "bottom",
      },
      {
        target: "[data-tour='preset-button']",
        title: t("tour.presetTitle"),
        content: t("tour.presetDescription"),
        position: "bottom",
      },
      {
        target: "[data-tour='chat-input']",
        title: t("tour.chatTitle"),
        content: t("tour.chatDescription"),
        position: "top",
      },
    ];
    
    setCurrentTourSteps(characterSteps);
    setIsTourVisible(true);
  };

  const completeTour = () => {
    setIsTourVisible(false);
    if (currentTourSteps.length > 0 && currentTourSteps[0].target === "body") {
      localStorage.setItem(TOUR_STORAGE_KEY, "true");
    }
  };

  const skipTour = () => {
    setIsTourVisible(false);  
    if (currentTourSteps.length > 0 && currentTourSteps[0].target === "body") {
      localStorage.setItem(TOUR_STORAGE_KEY, "true");
    }
  };

  const resetTour = () => {
    localStorage.removeItem(TOUR_STORAGE_KEY);
    localStorage.removeItem(CHARACTER_TOUR_STORAGE_KEY);
    setIsTourVisible(false);
  };

  return {
    isTourVisible,
    currentTourSteps,
    startHomeTour,
    startCharacterTour,
    completeTour,
    skipTour,
    resetTour,
  };
} 
