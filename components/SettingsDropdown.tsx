"use client";

import { useEffect, useRef, useState } from "react";
import { useLanguage } from "@/app/i18n";
import { useSoundContext } from "@/contexts/SoundContext";
import { useTour } from "@/hooks/useTour";
import { exportDataToFile, importDataFromFile, generateExportFilename, downloadFile } from "@/function/data/export-import";
import { subscribeToUserSession } from "@/utils/user-session";

interface SettingsDropdownProps {
  toggleModelSidebar: () => void;
  openLoginModal: () => void;
}

export default function SettingsDropdown({ toggleModelSidebar, openLoginModal }: SettingsDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [username, setUsername] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { language, setLanguage, t } = useLanguage();
  const { soundEnabled, toggleSound } = useSoundContext();
  const { resetTour } = useTour();

  useEffect(() => {
    return subscribeToUserSession((session) => {
      setIsLoggedIn(session.isLoggedIn);
      setUsername(session.username);
    });
  }, []);

  const toggleLanguage = () => {
    const newLanguage = language === "zh" ? "en" : "zh";
    setLanguage(newLanguage);
    document.documentElement.lang = newLanguage;
  };

  const openModelSettings = () => {
    toggleModelSidebar();
    setIsOpen(false);
  };

  const openUsernameSettings = () => {
    setIsOpen(false);
    openLoginModal();
  };

  const handleExportData = async () => {
    try {
      const blob = await exportDataToFile();
      const filename = generateExportFilename();
      downloadFile(blob, filename);
      setIsOpen(false);
    } catch (error) {
      console.error("Export failed:", error);
      alert(t("common.exportFailed"));
    }
  };

  const handleImportData = async () => {
    try {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json";
      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
          await importDataFromFile(file);
          setIsOpen(false);
          window.location.reload();
        }
      };
      input.click();
    } catch (error) {
      console.error("Import failed:", error);
      alert(t("common.importFailed"));
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {isOpen && (
        <button
          type="button"
          aria-label={t("common.close")}
          onClick={() => setIsOpen(false)}
          className="fixed inset-0 z-40 cursor-default"
        />
      )}

      <button
        onClick={() => setIsOpen(!isOpen)}
        data-tour="settings-button"
        className="relative z-50 flex h-10 w-10 items-center justify-center text-[#f4e8c1] bg-[#1c1c1c] rounded-lg border border-[#333333] shadow-inner transition-all duration-300 hover:bg-[#252525] hover:border-[#444444] hover:text-amber-400 hover:shadow-[0_0_8px_rgba(251,146,60,0.4)] md:h-8 md:w-8"
        aria-label={t("common.settings")}
        aria-expanded={isOpen}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform duration-300 ${isOpen ? "rotate-90" : ""}`}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>

      {isOpen && (
        <div className="fixed right-3 top-16 z-50 w-56 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-md border border-[#333333] bg-[#1c1c1c] shadow-lg md:absolute md:right-0 md:top-full md:mt-2 md:w-48">
          <div className="py-1">
            <button
              onClick={openUsernameSettings}
              className="flex items-center justify-between w-full gap-3 px-4 py-2 text-sm text-[#f4e8c1] hover:bg-[#252525] transition-colors"
              title={isLoggedIn && username ? username : t("sidebar.nologin")}
            >
              <span className="flex min-w-0 items-center">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2 flex-shrink-0">
                  <path d="M20 21a8 8 0 1 0-16 0"></path>
                  <circle cx="12" cy="7" r="4"></circle>
                </svg>
                <span className="truncate">
                  {isLoggedIn ? t("auth.username") : t("sidebar.nologin")}
                </span>
              </span>
              {isLoggedIn && username && (
                <span className="max-w-[7rem] truncate text-xs text-[#a18d6f]">
                  {username}
                </span>
              )}
            </button>

            <div className="border-t border-[#333333] my-1"></div>

            <button
              onClick={toggleLanguage}
              className="flex items-center w-full px-4 py-2 text-sm text-[#f4e8c1] hover:bg-[#252525] transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2">
                <path d="M5 8l6 6"></path>
                <path d="M4 14l6-6 2-3"></path>
                <path d="M2 5h12"></path>
                <path d="M7 2h1"></path>
                <path d="M22 22l-5-10-5 10"></path>
                <path d="M14 18h6"></path>
              </svg>
              {language === "zh" ? t("common.switchToEnglish") : t("common.switchToChinese")}
            </button>
            
            <button
              onClick={openModelSettings}
              className="flex items-center w-full px-4 py-2 text-sm text-[#f4e8c1] hover:bg-[#252525] transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="3" y1="9" x2="21" y2="9"></line>
                <line x1="9" y1="21" x2="9" y2="9"></line>
              </svg>
              {t("modelSettings.title")}
            </button>
            
            <button
              onClick={toggleSound}
              className="flex items-center w-full px-4 py-2 text-sm text-[#f4e8c1] hover:bg-[#252525] transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2">
                {soundEnabled ? (
                  <>
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                    <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
                  </>
                ) : (
                  <>
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                    <line x1="23" y1="9" x2="17" y2="15"></line>
                    <line x1="17" y1="9" x2="23" y2="15"></line>
                  </>
                )}
              </svg>
              {soundEnabled ? t("common.soundOff") : t("common.soundOn")}
            </button>
            
            <button
              onClick={() => {
                resetTour();
                setIsOpen(false);
                window.location.reload();
              }}
              className="flex items-center w-full px-4 py-2 text-sm text-[#f4e8c1] hover:bg-[#252525] transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2">
                <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                <path d="M21 3v5h-5" />
                <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                <path d="M3 21v-5h5" />
              </svg>
              {t("tour.resetTour")}
            </button>
            
            <div className="border-t border-[#333333] my-1"></div>
            
            <button
              onClick={handleExportData}
              className="flex items-center w-full px-4 py-2 text-sm text-[#f4e8c1] hover:bg-[#252525] transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              {t("common.exportData")}
            </button>

            <button
              onClick={handleImportData}
              className="flex items-center w-full px-4 py-2 text-sm text-[#f4e8c1] hover:bg-[#252525] transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="17 8 12 3 7 8"></polyline>
                <line x1="12" y1="3" x2="12" y2="15"></line>
              </svg>
              {t("common.importData")}
            </button>
          </div>
        </div>
      )}      
    </div>
  );
}
