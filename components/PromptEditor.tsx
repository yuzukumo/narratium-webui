import React, { useState, useEffect } from "react";
import { useLanguage } from "@/app/i18n";
import { trackButtonClick } from "@/utils/google-analytics";

interface PromptEditorProps {
  isOpen: boolean;
  onClose: () => void;
  characterId: string;
  characterName: string;
  onSave: (prompts: {
    prefixPrompt: string;
    chainOfThoughtPrompt: string;
    suffixPrompt: string;
  }) => void;
  initialPrompts?: {
    prefixPrompt: string;
    chainOfThoughtPrompt: string;
    suffixPrompt: string;
  };
}

const PromptEditor: React.FC<PromptEditorProps> = ({
  isOpen,
  onClose,
  characterId,
  characterName,
  onSave,
  initialPrompts = {
    prefixPrompt: "",
    chainOfThoughtPrompt: "",
    suffixPrompt: "",
  },
}) => {
  const { t, fontClass, serifFontClass } = useLanguage();
  const [activeTab, setActiveTab] = useState<"prefix" | "chain" | "suffix">("prefix");
  const [prefixPrompt, setPrefixPrompt] = useState(initialPrompts.prefixPrompt);
  const [chainOfThoughtPrompt, setChainOfThoughtPrompt] = useState(initialPrompts.chainOfThoughtPrompt);
  const [suffixPrompt, setSuffixPrompt] = useState(initialPrompts.suffixPrompt);
  const [isDragging, setIsDragging] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [startPosition, setStartPosition] = useState({ x: 0, y: 0 });
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    
    handleResize();
    window.addEventListener("resize", handleResize);
    
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (isOpen) {
      if (isMobile) {
        setPosition({
          x: Math.max(window.innerWidth / 2 - (window.innerWidth * 0.45), 0),
          y: Math.max(window.innerHeight / 2 - (window.innerHeight * 0.35), 0),
        });
      } else {
        setPosition({
          x: Math.max(window.innerWidth / 2 - 250, 0),
          y: Math.max(window.innerHeight / 2 - 200, 0),
        });
      }
    }
  }, [isOpen, isMobile]);

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    setIsDragging(true);
    setStartPosition({
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isDragging) {
      setPosition({
        x: e.clientX - startPosition.x,
        y: e.clientY - startPosition.y,
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleSave = () => {
    onSave({
      prefixPrompt,
      chainOfThoughtPrompt,
      suffixPrompt,
    });
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div 
        className="absolute inset-0 backdrop-blur-sm bg-opacity-50"
        onClick={() => {
          onClose();
        }}
      />
      <div 
        className="absolute fantasy-bg border border-[#534741] rounded-lg shadow-lg overflow-hidden backdrop-filter backdrop-blur-sm"
        style={{
          width: isMobile ? "90%" : "500px",
          height: isMobile ? "90%" : "400px",
          maxHeight: isMobile ? "50vh" : "80vh",
          left: isMobile ? "5%" : `${position.x}px`,
          top: isMobile ? "25%" : `${position.y}px`,
        }}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <div 
          className="bg-[#252525] p-3 flex items-center justify-between cursor-move"
          onMouseDown={handleMouseDown}
        >
          <div className="flex items-center">
            <div className="w-8 h-8 flex items-center justify-center text-amber-400 bg-[#1c1c1c] rounded-lg border border-amber-400 shadow-[0_0_8px_rgba(251,146,60,0.4)] mr-3">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9"></path>
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
              </svg>
            </div>
            <h3 className={`text-amber-400 text-lg ${serifFontClass}`}>
              {t("characterChat.customPromptFor")}
            </h3>
          </div>
          <button 
            onClick={(e) => {trackButtonClick("PromptEditor", "关闭"); e.stopPropagation(); onClose();}}
            className="text-[#8a8a8a] hover:text-amber-400 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <div className="flex border-b border-[#534741] overflow-x-auto">
          <button
            className={`px-2 py-2 ${fontClass} ${isMobile ? "text-xs" : "text-sm"} ${activeTab === "prefix" ? "bg-[#252525] text-amber-400 border-b-2 border-amber-400" : "text-[#8a8a8a] hover:text-[#f4e8c1]"}`}
            onClick={() => {trackButtonClick("PromptEditor", "前缀"); setActiveTab("prefix");}}
          >
            {t("characterChat.prefixPrompt")}
          </button>
          <button
            className={`px-2 py-2 ${fontClass} ${isMobile ? "text-xs" : "text-sm"} ${activeTab === "chain" ? "bg-[#252525] text-amber-400 border-b-2 border-amber-400" : "text-[#8a8a8a] hover:text-[#f4e8c1]"}`}
            onClick={() => {trackButtonClick("PromptEditor", "链式思维"); setActiveTab("chain");}}
          >
            {t("characterChat.chainOfThoughtPrompt")}
          </button>
          <button
            className={`px-2 py-2 ${fontClass} ${isMobile ? "text-xs" : "text-sm"} ${activeTab === "suffix" ? "bg-[#252525] text-amber-400 border-b-2 border-amber-400" : "text-[#8a8a8a] hover:text-[#f4e8c1]"}`}
            onClick={() => {trackButtonClick("PromptEditor", "后缀"); setActiveTab("suffix");}}
          >
            {t("characterChat.suffixPrompt")}
          </button>
        </div>

        <div className={`p-4 ${isMobile ? "h-[calc(100%-140px)]" : "h-[260px]"} overflow-auto fantasy-scrollbar`}>
          {activeTab === "prefix" && (
            <div className="space-y-2">
              <p className={`text-xs text-[#8a8a8a] ${fontClass}`}>
                {t("characterChat.prefixPromptDescription")}
              </p>
              <textarea
                value={prefixPrompt}
                onChange={(e) => setPrefixPrompt(e.target.value)}
                className={`w-full ${isMobile ? "h-[calc(100vh-300px)]" : "h-[200px]"} bg-[#1c1c1c] border border-[#534741] rounded p-3 text-[#f4e8c1] ${isMobile ? "text-xs" : "text-sm"} focus:outline-none focus:border-amber-400 fantasy-scrollbar`}
                placeholder={t("characterChat.prefixPromptPlaceholder") as string}
              />
            </div>
          )}

          {activeTab === "chain" && (
            <div className="space-y-2">
              <p className={`text-xs text-[#8a8a8a] ${fontClass}`}>
                {t("characterChat.chainOfThoughtPromptDescription")}
              </p>
              <textarea
                value={chainOfThoughtPrompt}
                onChange={(e) => setChainOfThoughtPrompt(e.target.value)}
                className={`w-full ${isMobile ? "h-[calc(100vh-300px)]" : "h-[200px]"} bg-[#1c1c1c] border border-[#534741] rounded p-3 text-[#f4e8c1] ${isMobile ? "text-xs" : "text-sm"} focus:outline-none focus:border-amber-400 fantasy-scrollbar`}
                placeholder={t("characterChat.chainOfThoughtPromptPlaceholder") as string}
              />
            </div>
          )}

          {activeTab === "suffix" && (
            <div className="space-y-2">
              <p className={`text-xs text-[#8a8a8a] ${fontClass}`}>
                {t("characterChat.suffixPromptDescription")}
              </p>
              <textarea
                value={suffixPrompt}
                onChange={(e) => setSuffixPrompt(e.target.value)}
                className={`w-full ${isMobile ? "h-[calc(100vh-300px)]" : "h-[200px]"} bg-[#1c1c1c] border border-[#534741] rounded p-3 text-[#f4e8c1] ${isMobile ? "text-xs" : "text-sm"} focus:outline-none focus:border-amber-400 fantasy-scrollbar`}
                placeholder={t("characterChat.suffixPromptPlaceholder") as string}
              />
            </div>
          )}
        </div>

        <div className="p-3 border-t border-[#534741] flex justify-between items-center bg-[#1c1c1c] flex-wrap">
          <div className="flex items-center text-xs text-[#8a8a8a] mr-2 mb-1">
            <div className="w-2 h-2 rounded-full bg-amber-400 mr-2 animate-pulse"></div>
            <span className={fontClass}>{t("characterChat.autoSaveEnabled")}</span>
          </div>
          <div className="flex space-x-5">
            <button
              onClick={onClose}
              className={`text-[#8a8a8a] hover:text-amber-400 transition-colors duration-300 ${serifFontClass} text-sm`}
            >
              {t("common.cancel")}
            </button>
            <button
              onClick={handleSave}
              className={`text-amber-400 hover:text-amber-300 transition-colors duration-300 ${serifFontClass} text-sm`}
            >
              {t("common.save")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PromptEditor;
