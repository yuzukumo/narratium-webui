/**
 * Character Card Grid Component
 * 
 * This component provides a grid layout display for character cards with the following features:
 * - Responsive grid layout (1-3 columns based on screen size)
 * - Animated card appearance with staggered loading
 * - Interactive card tilt effect with glare
 * - Quick action buttons for chat, edit, and delete
 * - Avatar display with fallback
 * - Character name and personality preview
 * 
 * The component handles:
 * - Character card rendering and layout
 * - Interactive animations and effects
 * - Action button event handling
 * - Responsive design adaptation
 * 
 * Dependencies:
 * - CharacterAvatarBackground: For avatar display
 * - useLanguage: For internationalization
 */

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/app/i18n";
import { CharacterAvatarBackground } from "@/components/CharacterAvatarBackground";
import { trackButtonClick } from "@/utils/google-analytics";

/**
 * Interface definitions for the component's data structures
 */
interface Character {
  id: string;
  name: string;
  personality: string;
  scenario?: string;
  first_mes?: string;
  creatorcomment?: string;
  created_at: string;
  last_used_at?: string;
  avatar_path?: string;
}

interface CharacterCardGridProps {
  characters: Character[];
  onEditClick: (character: Character, e: React.MouseEvent) => void;
  onDeleteClick: (characterId: string) => void;
}

/**
 * Main grid component for displaying character cards
 * 
 * @param {CharacterCardGridProps} props - Component props
 * @returns {JSX.Element} The rendered grid of character cards
 */
const CharacterCardGrid: React.FC<CharacterCardGridProps> = ({
  characters,
  onEditClick,
  onDeleteClick,
}) => {
  const { t, language, serifFontClass } = useLanguage();
  const router = useRouter();
  const navigateToCharacter = (characterId: string) => {
    router.push(`/character?id=${characterId}`);
  };

  return (
    <div
      className="ui-fade-in grid grid-cols-1 justify-items-center gap-4 sm:grid-cols-2 lg:grid-cols-3"
    >
      {characters.map((character, index) => (
        <div
          key={character.id}
          style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
          className="ui-enter-up large-list-row w-full min-w-0 max-w-[240px]"
        >
          <div className="relative h-full overflow-hidden rounded-md border border-[#534741]/55 bg-[#241f1b]/65 transition-colors duration-200 hover:border-[#81684d]">
            {/* Action buttons for each card */}
            <div className="absolute top-2 right-2 flex space-x-1 z-10">
              <Link
                href={`/character?id=${character.id}`}
                onClick={(e) => e.stopPropagation()}
                className="p-1.5 bg-[#252220] hover:bg-[#3a2a2a] rounded-full text-[#c0a480] hover:text-[#ffd475] transition-colors"
                title={t("characterCardsPage.chat")}
                aria-label={t("characterCardsPage.chat")}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#c0a480] hover:text-[#ffd475] transition-colors">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                </svg>
              </Link>
              <button
                onClick={(e) => {trackButtonClick("edit_character_btn", "编辑角色"); onEditClick(character, e);}}
                className="p-1.5 bg-[#252220] hover:bg-[#3a2a2a] rounded-full text-[#c0a480] hover:text-[#ffd475] transition-colors"
                title={t("characterCardsPage.edit")}
                aria-label={t("characterCardsPage.edit")}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
              </button>
              <button
                onClick={(e) => {
                  trackButtonClick("delete_character_btn", "删除角色");
                  e.stopPropagation();
                  onDeleteClick(character.id);
                }}
                className="p-1.5 bg-[#252220] hover:bg-[#3a2a2a] rounded-full text-[#c0a480] hover:text-[#ffd475] transition-colors"
                title={t("characterCardsPage.delete")}
                aria-label={t("characterCardsPage.delete")}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
              </button>
            </div>

            {/* Character card content */}
            <div
              role="link"
              tabIndex={0}
              onClick={() => navigateToCharacter(character.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  navigateToCharacter(character.id);
                }
              }}
              className="block h-full w-full text-left cursor-pointer"
            >
              <div className="h-full flex flex-col">
                <div className="relative aspect-[4/5] w-full overflow-hidden">
                  {character.avatar_path ? (
                    <CharacterAvatarBackground avatarPath={character.avatar_path} />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-[#252220]">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-24 w-24 text-[#534741]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                    </div>
                  )}
                </div>

                <div className="flex min-h-24 flex-1 flex-col p-4">
                  <h2 className={`line-clamp-2 break-words text-lg leading-6 text-[#eae6db] magical-text ${serifFontClass}`} title={character.name}>{character.name}</h2>
                  <div className="mt-auto flex items-end justify-between gap-3 pt-3 text-[11px] text-[#8f806d]">
                    <span aria-hidden="true" className="text-[#c89b55]">✦</span>
                    {character.last_used_at && (
                      <time dateTime={character.last_used_at} className="min-w-0 truncate text-right" title={new Date(character.last_used_at).toLocaleString(language)}>
                        {t("characterCardsPage.lastUsed")} {new Date(character.last_used_at).toLocaleDateString(language)}
                      </time>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export default CharacterCardGrid; 
