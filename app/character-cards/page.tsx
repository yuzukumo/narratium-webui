/**
 * Character Cards Page Component
 * 
 * This page serves as the main interface for managing character cards in the application.
 * Features include:
 * - Grid and carousel view modes for character cards
 * - Character import functionality
 * - Character editing capabilities
 * - Character deletion
 * - Responsive design with fantasy-themed UI
 * 
 * The page integrates with various modals for character management and
 * provides a rich user experience with animations and interactive elements.
 * 
 * Dependencies:
 * - ImportCharacterModal: For importing new characters
 * - EditCharacterModal: For editing existing character
 * - CharacterCardGrid: For displaying characters in grid view
 * - Framer Motion: For animations
 */

"use client";

import React, { useState, useEffect } from "react";
import { useLanguage } from "@/app/i18n";
import { motion } from "framer-motion";
import ImportCharacterModal from "@/components/ImportCharacterModal";
import EditCharacterModal from "@/components/EditCharacterModal";
import CharacterCardGrid from "@/components/CharacterCardGrid";
import CharacterCardCarousel from "@/components/CharacterCardCarousel";
import { getAllCharacters } from "@/function/character/list";
import { deleteCharacter } from "@/function/character/delete";
import { trackButtonClick } from "@/utils/google-analytics";

/**
 * Interface defining the structure of a character object
 */
interface Character {
  id: string;
  name: string;
  personality: string;
  scenario?: string;
  first_mes?: string;
  creatorcomment?: string;
  created_at: string;
  avatar_path?: string;
}

/**
 * Main character cards page component
 * 
 * Manages the display and interaction with character cards, including:
 * - Fetching and displaying character data
 * - Handling character operations (import, edit, delete)
 * - Managing view modes (grid/carousel)
 * - Providing loading states and empty states
 * 
 * @returns {JSX.Element} The complete character cards page interface
 */
export default function CharacterCards() {
  const { t, fontClass, serifFontClass } = useLanguage();
  const [characters, setCharacters] = useState<Character[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [currentCharacter, setCurrentCharacter] = useState<Character | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "carousel">("grid");
  const [mounted, setMounted] = useState(false);
  const [imagesLoaded, setImagesLoaded] = useState(false);

  useEffect(() => {
    const savedViewMode = localStorage.getItem("characterCardsViewMode");
    if (savedViewMode === "grid" || savedViewMode === "carousel") {
      setViewMode(savedViewMode);
    }
  }, []);

  useEffect(() => {
    setMounted(true);
    const yellowImg = new Image();
    const redImg = new Image();
    
    yellowImg.src = "/background_yellow.png";
    redImg.src = "/background_red.png";
    
    Promise.all([
      new Promise(resolve => yellowImg.onload = resolve),
      new Promise(resolve => redImg.onload = resolve),
    ]).then(() => {
      setImagesLoaded(true);
    });
  }, []);

  const fetchCharacters = async () => {
    setIsLoading(true);
    const username = localStorage.getItem("username") || "";
    const language = localStorage.getItem("language") || "zh";
    try {
      const response = await getAllCharacters(language as "zh" | "en", username);

      if (!response) {
        setCharacters([]);
        return;
      }

      setCharacters(response);
    } catch (err) {
      console.error("Error fetching characters:", err);
      setCharacters([]);
    } finally {
      setIsLoading(false);
    }
  };
    
  const handleDeleteCharacter = async (characterId: string) => {
    setIsLoading(true);
    try {
      const response = await deleteCharacter(characterId);

      if (!response.success) {
        throw new Error(t("characterCardsPage.deleteFailed"));
      }

      fetchCharacters();
    } catch (err) {
      console.error("Error deleting character:", err);
      setIsLoading(false);
    }
  };

  const handleEditClick = (character: Character, e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentCharacter(character);
    setIsEditModalOpen(true);
  };

  const handleEditSuccess = () => {
    fetchCharacters();
    setIsEditModalOpen(false);
    setCurrentCharacter(null);
  };

  useEffect(() => {
    fetchCharacters();
  }, []);

  if (!mounted) return null;

  return (
    <div className="h-full w-full overflow-x-hidden overflow-y-hidden login-fantasy-bg relative">
      <div
        className={`absolute inset-0 z-0 opacity-35 transition-opacity duration-500 ${
          imagesLoaded ? "opacity-35" : "opacity-0"
        }`}
        style={{
          backgroundImage: "url('/background_yellow.png')",
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        }}
      />

      <div
        className={`absolute inset-0 z-1 opacity-45 transition-opacity duration-500 ${
          imagesLoaded ? "opacity-45" : "opacity-0"
        }`}
        style={{
          backgroundImage: "url('/background_red.png')",
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
          mixBlendMode: "multiply",
        }}
      />
      
      <div className="h-full w-full overflow-y-auto">
        <div className="flex flex-col items-center justify-start w-full py-8">
          <div className="w-full max-w-4xl relative z-10 px-4">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="flex flex-col items-start gap-4 sm:flex-row sm:justify-between sm:items-center mb-8"
            >
              <div className="flex items-center gap-3">
                <h1 className={`text-xl sm:text-2xl magical-login-text ${serifFontClass}`}>{t("sidebar.characterCards")}</h1>
                <motion.button
                  className={`portal-button text-[#c0a480] hover:text-[#ffd475] p-2 border border-[#534741] rounded-lg cursor-pointer ${fontClass} translate-y-[1px]`}
                  whileHover={{ scale: 1.05 }}
                  transition={{ type: "spring", stiffness: 400, damping: 10 }}
                  onClick={() => {
                    trackButtonClick("view_mode_btn", "切换视图模式");
                    const newViewMode = viewMode === "grid" ? "carousel" : "grid";
                    setViewMode(newViewMode);
                    localStorage.setItem("characterCardsViewMode", newViewMode);
                  }}
                >
                  {viewMode === "grid" ? (
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="7" height="7"></rect>
                      <rect x="14" y="3" width="7" height="7"></rect>
                      <rect x="14" y="14" width="7" height="7"></rect>
                      <rect x="3" y="14" width="7" height="7"></rect>
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10"></circle>
                      <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"></polygon>
                    </svg>
                  )}
                </motion.button>
              </div>
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:gap-3">
                <motion.div
                  className={`portal-button relative overflow-hidden px-4 py-2 rounded-lg cursor-pointer text-center ${fontClass}
                    bg-gradient-to-b from-[#2a231c] to-[#1a1510]
                    border border-[#534741]
                    shadow-[0_0_15px_rgba(192,164,128,0.1)]
                    hover:shadow-[0_0_20px_rgba(192,164,128,0.2)]
                    before:absolute before:inset-0 before:bg-gradient-to-r before:from-transparent before:via-[rgba(192,164,128,0.1)] before:to-transparent
                    before:translate-x-[-100%] hover:before:translate-x-[100%] before:transition-transform before:duration-700
                    group`}
                  whileHover={{ 
                    scale: 1.01,
                    boxShadow: "0 0 25px rgba(192,164,128,0.3)",
                  }}
                  whileTap={{ scale: 0.98 }}
                  transition={{ 
                    type: "spring", 
                    stiffness: 400, 
                    damping: 10, 
                  }}
                  onClick={() => setIsImportModalOpen(true)}
                >
                  <span className="relative z-10 text-[#c0a480] group-hover:text-[#ffd475] transition-colors duration-300">
                    {t("characterCardsPage.importCharacter")}
                  </span>
                </motion.div>
              </div>
            </motion.div>

            {isLoading ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex justify-center items-center h-64"
              >
                <div className="relative w-16 h-16">
                  <div className="absolute inset-0 rounded-full border-2 border-t-[#f9c86d] border-r-[#c0a480] border-b-[#a18d6f] border-l-transparent animate-spin"></div>
                  <div className="absolute inset-2 rounded-full border-2 border-t-[#a18d6f] border-r-[#f9c86d] border-b-[#c0a480] border-l-transparent animate-spin-slow"></div>
                  <div className={`absolute w-full text-center top-20 text-[#c0a480] ${fontClass}`}>{t("characterCardsPage.loading")}</div>
                </div>
              </motion.div>
            ) : characters.length === 0 ? (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="session-card p-8 text-center"
              >
                <div className="mb-6 opacity-60">
                  <svg className="mx-auto" width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M32 0L38 20H60L42 32L48 52L32 40L16 52L22 32L4 20H26L32 0Z" fill="#f9c86d" fillOpacity="0.3" />
                  </svg>
                </div>
                <p className={`text-[#eae6db] mb-6 ${serifFontClass}`}>{t("characterCardsPage.noCharacters")}</p>
                <motion.div
                  className={`portal-button inline-block text-[#c0a480] hover:text-[#ffd475] px-5 py-2 border border-[#534741] rounded-lg cursor-pointer ${fontClass}`}
                  whileHover={{ scale: 1.05 }}
                  transition={{ type: "spring", stiffness: 400, damping: 10 }}
                  onClick={() => setIsImportModalOpen(true)}
                >
                  {t("characterCardsPage.importFirstCharacter")}
                </motion.div>
              </motion.div>
            ) : viewMode === "grid" ? (
              <CharacterCardGrid
                characters={characters}
                onEditClick={handleEditClick}
                onDeleteClick={handleDeleteCharacter}
              />
            ) : (
              <CharacterCardCarousel
                characters={characters}
                onEditClick={handleEditClick}
                onDeleteClick={handleDeleteCharacter}
              />
            )}
          </div>

          <ImportCharacterModal
            isOpen={isImportModalOpen}
            onClose={() => setIsImportModalOpen(false)}
            onImport={fetchCharacters}
          />
          {currentCharacter && (
            <EditCharacterModal
              isOpen={isEditModalOpen}
              onClose={() => setIsEditModalOpen(false)}
              characterId={currentCharacter.id}
              characterData={{
                name: currentCharacter.name,
                personality: currentCharacter.personality,
                scenario: currentCharacter.scenario,
                first_mes: currentCharacter.first_mes,
                creatorcomment: currentCharacter.creatorcomment,
                avatar_path: currentCharacter.avatar_path,
              }}
              onSave={handleEditSuccess}
            />
          )}
        </div>
      </div>
    </div>
  );
}
