import React, { useState, useEffect } from "react";
import { useLanguage } from "@/app/i18n";
import Link from "next/link";
import DialogueTreeModal from "@/components/DialogueTreeModal";
import { trackButtonClick } from "@/utils/google-analytics";
import { CharacterAvatarBackground } from "@/components/CharacterAvatarBackground";
import AdvancedSettingsEditor from "@/components/AdvancedSettingsEditor";
import {
  DEFAULT_RESPONSE_LENGTH,
  MIN_RESPONSE_LENGTH,
  getStoredResponseLength,
  persistResponseLength,
} from "@/utils/api-config";

interface CharacterSidebarProps {
  character: {
    id: string;
    name: string;
    personality?: string;
    avatar_path?: string;
    scenario?: string;
  };
  isCollapsed: boolean;
  toggleSidebar: () => void;
  onDialogueEdit?: () => void;
  onViewSwitch?: () => void;
}

const CharacterSidebar: React.FC<CharacterSidebarProps> = ({
  character,
  isCollapsed,
  toggleSidebar,
  onDialogueEdit,
  onViewSwitch,
}) => {
  const { t, fontClass, serifFontClass, language } = useLanguage();
  const [responseLengthInput, setResponseLengthInput] = useState<string>(DEFAULT_RESPONSE_LENGTH.toString());
  const [isAdvancedSettingsOpen, setIsAdvancedSettingsOpen] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setResponseLengthInput(getStoredResponseLength().toString());
    }
  }, []);

  const [showDialogueTreeModal, setShowDialogueTreeModal] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  
  const handleResponseLengthChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.value;
    if (!/^\d*$/.test(nextValue)) {
      return;
    }

    setResponseLengthInput(nextValue);
  };

  const handleResponseLengthBlur = () => {
    const normalized = persistResponseLength(responseLengthInput || DEFAULT_RESPONSE_LENGTH);
    setResponseLengthInput(normalized.toString());
  };
  
  const handleOpenPromptEditor = () => {
    trackButtonClick("CharacterSidebar", "切换到预设编辑器");
    if (typeof window !== "undefined") {
      const event = new CustomEvent("switchToPresetView", {
        detail: { characterId: character.id },
      });
      window.dispatchEvent(event);
    }
  };
  
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };

    handleResize();
    window.addEventListener("resize", handleResize);

    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const mobileSidebarClass = isMobile
    ? (isCollapsed
      ? "hidden"
      : "!fixed inset-y-0 left-0 z-40 w-[85vw] max-w-[20rem] translate-x-0 opacity-100 text-[13px] leading-tight shadow-2xl shadow-black/40")
    : (isCollapsed
      ? "w-0 p-0 opacity-0 breathing-bg"
      : "w-[18rem] text-[14px] leading-normal breathing-bg");

  return (
    <>      
      <div
        className={`${mobileSidebarClass}
          md:relative breathing-bg overflow-y-auto overflow-x-hidden fantasy-scrollbar
          border-r border-[#42382f]
          h-full flex flex-col
          magic-border transition-all duration-300 ease-in-out`}
      >

        <div className="px-2 py-1 flex justify-between items-center text-xs text-[#8a8a8a] uppercase tracking-wider font-medium text-[10px] transition-all duration-300 ease-in-out overflow-hidden mt-4 mx-3 md:mx-4" style={{ opacity: isCollapsed ? 0 : 1 }}>
          <span>{t("characterChat.navigation")}</span>
        </div>

        <div className="transition-all duration-300 ease-in-out px-4 md:px-6 max-h-[500px] opacity-100">
          <div className="space-y-1 my-2">
            {!isCollapsed ? (
              <>
                <Link
                  href="/character-cards"
                  className="menu-item relative group flex items-center p-2 rounded-md hover:bg-[#252525] overflow-hidden transition-all duration-300"
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-amber-500/10 via-transparent to-transparent rounded-md opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-0" />
                  <div className="absolute inset-0 w-full h-full bg-[#333] opacity-0 group-hover:opacity-10 transition-opacity duration-300 z-0" />
                  <div className="absolute bottom-0 left-0 h-[1px] bg-gradient-to-r from-transparent via-blue-400 to-transparent w-0 group-hover:w-full transition-all duration-500 z-5" />
                  <div className="relative z-5 flex items-center">
                    <div className={`${isMobile ? "w-6 h-6" : "w-8 h-8"} flex items-center justify-center flex-shrink-0 text-[#f4e8c1] bg-[#1c1c1c] rounded-lg border border-[#333333] shadow-inner transition-all duration-300 group-hover:border-[#444444] group-hover:text-amber-400 group-hover:shadow-[0_0_8px_rgba(251,146,60,0.4)]`}>
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M10 17l-5-5 5-5" />
                        <path d="M5 12h10a4 4 0 0 1 4 4" />
                      </svg>
                    </div>
                    <div className="ml-2 transition-all duration-300 ease-in-out overflow-hidden">
                      <span className={`magical-text whitespace-nowrap block text-sm group-hover:text-amber-400 transition-colors duration-300 ${fontClass}`}>
                        {t("characterChat.backToCharacters")}
                      </span>
                    </div>
                  </div>
                </Link>

                <button
                  onClick={() => {
                    trackButtonClick("CharacterSidebar", "切换角色侧边栏");
                    toggleSidebar();
                  }}
                  className="menu-item relative group flex items-center w-full p-2 rounded-md hover:bg-[#252525] overflow-hidden transition-all duration-300 cursor-pointer"
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-amber-500/10 via-transparent to-transparent rounded-md opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-0" />
                  <div className="absolute inset-0 w-full h-full bg-[#333] opacity-0 group-hover:opacity-10 transition-opacity duration-300 z-0" />
                  <div className="absolute bottom-0 left-0 h-[1px] bg-gradient-to-r from-transparent via-blue-400 to-transparent w-0 group-hover:w-full transition-all duration-500 z-5" />
                  <div className="relative z-5 flex items-center">
                    <div className={`${isMobile ? "w-6 h-6" : "w-8 h-8"} flex items-center justify-center flex-shrink-0 text-[#f4e8c1] bg-[#1c1c1c] rounded-lg border border-[#333333] shadow-inner transition-all duration-300 group-hover:border-[#444444] group-hover:text-amber-400 group-hover:shadow-[0_0_8px_rgba(251,146,60,0.4)]`}>
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M19 12H5" />
                        <polyline points="12 19 5 12 12 5" />
                      </svg>
                    </div>
                    <div className="ml-2 transition-all duration-300 ease-in-out overflow-hidden">
                      <span className={`magical-text whitespace-nowrap block text-sm group-hover:text-amber-400 transition-colors duration-300 ${fontClass}`}>
                        {t("characterChat.collapseSidebar")}
                      </span>
                    </div>
                  </div>
                </button>
              </>
            ) : (
              <>
                <Link
                  href="/character-cards"
                  className="menu-item flex justify-center p-2 rounded-md cursor-pointer hover:bg-[#252525] transition-all duration-300"
                >
                  <div className={`${isMobile ? "w-6 h-6" : "w-8 h-8"} flex items-center justify-center text-[#f4e8c1] bg-[#1c1c1c] rounded-lg border border-[#333333] shadow-inner transition-all duration-300 group-hover:border-[#444444] hover:text-amber-400 hover:border-[#444444] hover:shadow-[0_0_8px_rgba(251,146,60,0.4)]`}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10 17l-5-5 5-5" />
                      <path d="M5 12h10a4 4 0 0 1 4 4" />
                    </svg>
                  </div>
                </Link>

                <button
                  onClick={() => {
                    trackButtonClick("CharacterSidebar", "切换角色侧边栏");
                    toggleSidebar();
                  }}
                  className="menu-item flex justify-center p-2 rounded-md cursor-pointer hover:bg-[#252525] transition-all duration-300"
                >
                  <div className={`${isMobile ? "w-6 h-6" : "w-8 h-8"} flex items-center justify-center text-[#f4e8c1] bg-[#1c1c1c] rounded-lg border border-[#333333] shadow-inner transition-all duration-300 group-hover:border-[#444444] hover:text-amber-400 hover:border-[#444444] hover:shadow-[0_0_8px_rgba(251,146,60,0.4)]`}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M19 12H5" />
                      <polyline points="12 19 5 12 12 5" />
                    </svg>
                  </div>
                </button>
              </>
            )}
          </div>
        </div>

        <div className="mx-3 md:mx-4 menu-divider my-2"></div>

        <div className="px-2 py-1 flex justify-between items-center text-xs text-[#8a8a8a] uppercase tracking-wider font-medium text-[10px] transition-all duration-300 ease-in-out overflow-hidden mx-3 md:mx-4" style={{ opacity: isCollapsed ? 0 : 1 }}>
          <span>{t("characterChat.characterInfo")}</span>
        </div>

        <div className="transition-all duration-300 ease-in-out px-4 md:px-6 max-h-[500px] opacity-100">
          <div className="space-y-1 my-2">
            {!isCollapsed ? (
              <div className={"menu-item flex p-2 rounded-md hover:bg-[#252525] overflow-hidden transition-all duration-300 group"}>
                <div className="w-12 h-12 flex-shrink-0 mr-3 flex items-center justify-center text-[#f4e8c1] bg-[#1c1c1c] rounded-lg border border-[#333333] shadow-inner transition-all duration-300 group-hover:border-[#444444] group-hover:text-amber-400 group-hover:shadow-[0_0_8px_rgba(251,146,60,0.4)]">
                  {character.avatar_path ? (
                    <CharacterAvatarBackground avatarPath={character.avatar_path} />
                  ) : (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="24" height="24"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  )}
                </div>
                <div className="flex flex-col justify-center">
                  <span className={`magical-text whitespace-nowrap overflow-hidden text-ellipsis block text-sm text-[#f4e8c1] group-hover:text-amber-400 transition-colors duration-300 ${serifFontClass}`}>
                    {character.name ? (character.name.length > 20 ? `${character.name.substring(0, 20)}...` : character.name) : ""}
                  </span>
                  <p className={`text-[#a18d6f] text-xs ${fontClass} whitespace-nowrap overflow-hidden text-ellipsis mt-1`}>
                    {character.personality ? (
                      character.personality.length > 25
                        ? `${character.personality.substring(0, 25)}...`
                        : character.personality
                    ) : t("characterChat.noPersonality")}
                  </p>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="mx-3 md:mx-4 menu-divider my-2"></div>
        <div className="px-2 py-1 flex justify-between items-center text-xs text-[#8a8a8a] uppercase tracking-wider font-medium text-[10px] transition-all duration-300 ease-in-out overflow-hidden mx-3 md:mx-4" style={{ opacity: isCollapsed ? 0 : 1 }}>
          <span>{t("characterChat.actions")}</span>
        </div>

        <div className="transition-all duration-300 ease-in-out px-4 md:px-6 max-h-[500px] opacity-100">
          <div className="space-y-1 my-2">
            {!isCollapsed ? (
              <div 
                className={"menu-item flex items-center p-2 rounded-md hover:bg-[#252525] cursor-pointer overflow-hidden transition-all duration-300 group"}
                onClick={() => setShowDialogueTreeModal(true)}
              >
                <div className="absolute inset-0 bg-gradient-to-br from-amber-500/10 via-transparent to-transparent rounded-md opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-0" />
                <div className="absolute inset-0 w-full h-full bg-[#333] opacity-0 group-hover:opacity-10 transition-opacity duration-300 z-0" />
                <div className="absolute bottom-0 left-0 h-[1px] bg-gradient-to-r from-transparent via-blue-400 to-transparent w-0 group-hover:w-full transition-all duration-500 z-5" />
                <div className="relative z-5 flex items-center">
                  <div className={`${isMobile ? "w-6 h-6" : "w-8 h-8"} flex items-center justify-center flex-shrink-0 text-[#f4e8c1] bg-[#1c1c1c] rounded-lg border border-[#333333] shadow-inner transition-all duration-300 group-hover:border-[#444444] group-hover:text-amber-400 group-hover:shadow-[0_0_8px_rgba(251,146,60,0.4)]`}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                    </svg>
                  </div>
                  <div className="ml-2 transition-all duration-300 ease-in-out overflow-hidden">
                    <p className={`text-[#f4e8c1] text-sm transition-colors duration-300 ${fontClass}`}>
                      {t("characterChat.Conversation")}
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div 
                className={"menu-item flex justify-center p-2 rounded-md cursor-pointer hover:bg-[#252525] transition-all duration-300"}
                onClick={() => setShowDialogueTreeModal(true)}
              >
                <div className={`${isMobile ? "w-6 h-6" : "w-8 h-8"} flex items-center justify-center text-[#f4e8c1] bg-[#1c1c1c] rounded-lg border border-[#333333] shadow-inner transition-all duration-300 group-hover:border-[#444444] hover:text-amber-400 hover:border-[#444444] hover:shadow-[0_0_8px_rgba(251,146,60,0.4)]`}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                  </svg>
                </div>
              </div>
            )}

          </div>
        </div>
        <div className="mx-3 md:mx-4 menu-divider my-2"></div>
            
        {!isCollapsed && (
          <>
            <div className="px-2 py-1 flex justify-between items-center text-xs text-[#8a8a8a] uppercase tracking-wider font-medium text-[10px] transition-all duration-300 ease-in-out overflow-hidden mx-3 md:mx-4" style={{ opacity: isCollapsed ? 0 : 1 }}>
              <span>{t("characterChat.presets") || "预设"}</span>
            </div>
            <div 
              className="menu-item flex items-center p-2 mx-4 md:mx-6 rounded-md hover:bg-[#252525] cursor-pointer overflow-hidden transition-all duration-300 group"
              onClick={handleOpenPromptEditor}
            >
              <div className="absolute inset-0 bg-gradient-to-br from-amber-500/10 via-transparent to-transparent rounded-md opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-0" />
              <div className="absolute inset-0 w-full h-full bg-[#333] opacity-0 group-hover:opacity-10 transition-opacity duration-300 z-0" />
              <div className="absolute bottom-0 left-0 h-[1px] bg-gradient-to-r from-transparent via-blue-400 to-transparent w-0 group-hover:w-full transition-all duration-500 z-5" />
              <div className="relative z-5 flex items-center">
                <div className={`${isMobile ? "w-6 h-6" : "w-8 h-8"} flex items-center justify-center flex-shrink-0 text-[#f4e8c1] bg-[#1c1c1c] rounded-lg border border-[#333333] shadow-inner transition-all duration-300 group-hover:border-[#444444] group-hover:text-amber-400 group-hover:shadow-[0_0_8px_rgba(251,146,60,0.4)]`}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 20h9"></path>
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                  </svg>
                </div>
                <div className="ml-2 transition-all duration-300 ease-in-out overflow-hidden">
                  <span className={`magical-text whitespace-nowrap block text-sm group-hover:text-amber-400 transition-colors duration-300 ${fontClass}`}>
                    {t("characterChat.presetEditor")}
                  </span>
                </div>
              </div>
            </div>

          </>
        )}
            
        <div className="mx-3 md:mx-4 menu-divider my-2"></div>
            
        <div className="px-2 py-1 flex justify-between items-center text-xs text-[#8a8a8a] uppercase tracking-wider font-medium text-[10px] transition-all duration-300 ease-in-out overflow-hidden mx-3 md:mx-4" style={{ opacity: isCollapsed ? 0 : 1 }}>
          <span>{t("characterChat.advancedSettings")}</span>
        </div>
        <div className="transition-all duration-300 ease-in-out px-4 md:px-6 max-h-[500px] opacity-100">
          <div className="space-y-1 my-2">
            {!isCollapsed ? (
              <div 
                className={"menu-item flex items-center p-2 rounded-md hover:bg-[#252525] cursor-pointer overflow-hidden transition-all duration-300 group"}
                onClick={() => {
                  trackButtonClick("CharacterSidebar", "打开高级设置");
                  setIsAdvancedSettingsOpen(true);
                }}
              >
                <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 via-transparent to-transparent rounded-md opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-0" />
                <div className="absolute inset-0 w-full h-full bg-[#333] opacity-0 group-hover:opacity-10 transition-opacity duration-300 z-0" />
                <div className="absolute bottom-0 left-0 h-[1px] bg-gradient-to-r from-transparent via-blue-400 to-transparent w-0 group-hover:w-full transition-all duration-500 z-5" />
                <div className="relative z-5 flex items-center">
                  <div className={`${isMobile ? "w-6 h-6" : "w-8 h-8"} flex items-center justify-center flex-shrink-0 text-[#f4e8c1] bg-[#1c1c1c] rounded-lg border border-[#333333] shadow-inner transition-all duration-300 group-hover:border-[#444444] group-hover:text-blue-400 group-hover:shadow-[0_0_8px_rgba(96,165,250,0.4)]`}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                      <path d="M12 6v2M12 16v2M6 12h2M16 12h2"/>
                      <path d="M8.5 8.5l1.5 1.5M14 14l1.5 1.5M8.5 15.5l1.5-1.5M14 10l1.5-1.5"/>
                    </svg>
                  </div>
                  <div className="ml-2 transition-all duration-300 ease-in-out overflow-hidden">
                    <span className={`magical-text whitespace-nowrap block text-sm group-hover:text-blue-400 transition-colors duration-300 ${fontClass}`}>
                      {t("characterChat.advancedSettings")}
                    </span>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
            
        <div className="mx-3 md:mx-4 menu-divider my-2"></div>
            
        <div className="px-2 py-1 flex justify-between items-center text-xs text-[#8a8a8a] uppercase tracking-wider font-medium text-[10px] transition-all duration-300 ease-in-out overflow-hidden mx-3 md:mx-4" style={{ opacity: isCollapsed ? 0 : 1 }}>
          <span>{t("characterChat.responseLength")}</span>
        </div>
        <div className="transition-all duration-300 ease-in-out px-4 md:px-6 max-h-[500px] opacity-100">
          <div className="space-y-1 my-2"></div>
          {!isCollapsed ? (
            <div className="px-2 py-2 space-y-3">
              <input
                type="text"
                inputMode="numeric"
                value={responseLengthInput}
                onChange={handleResponseLengthChange}
                onBlur={handleResponseLengthBlur}
                placeholder={DEFAULT_RESPONSE_LENGTH.toString()}
                className="w-full bg-[#1c1c1c] border border-[#534741] rounded-md py-2 px-3 text-sm text-[#f4e8c1] focus:outline-none focus:border-[#d1a35c] transition-colors"
              />
              <div className={`text-xs text-[#9ca3af] ${fontClass}`}>
                {language === "zh"
                  ? `最低 ${MIN_RESPONSE_LENGTH}，默认 ${DEFAULT_RESPONSE_LENGTH}，不设上限`
                  : `Minimum ${MIN_RESPONSE_LENGTH}, default ${DEFAULT_RESPONSE_LENGTH}, no upper limit`}
              </div>
            </div>
          ) : null}
        </div>
      </div>
      
      <DialogueTreeModal
        isOpen={showDialogueTreeModal}
        onClose={() => setShowDialogueTreeModal(false)}
        characterId={character.id}
        onDialogueEdit={onDialogueEdit}
      />

      <AdvancedSettingsEditor
        isOpen={isAdvancedSettingsOpen}
        onClose={() => setIsAdvancedSettingsOpen(false)}
        onViewSwitch={onViewSwitch}
      />
    </>
  );
};

export default CharacterSidebar;
