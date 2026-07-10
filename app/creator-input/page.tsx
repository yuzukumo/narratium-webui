/**
 * Creator Input Page Component
 * 
 * This is an input form page that provides:
 * - Text input area for user messages
 * - Animated background effects
 * - Form submission handling
 * - Keyboard shortcuts (Enter to send)
 * - Character count display
 * - Loading state management
 * - Responsive design
 * 
 * The page serves as an entry point for users to input their creative content
 * before being redirected to the creator area.
 * 
 * Dependencies:
 * - framer-motion: For animation effects
 * - lucide-react: For icons (Send, Sparkles)
 * - next/navigation: For routing
 * - Background images: background_yellow.png, background_red.png
 */

"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Send, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLanguage } from "../i18n";

export default function CreatorInputPage() {
  // Router and language utilities
  const router = useRouter();
  const { t, fontClass, serifFontClass, titleFontClass } = useLanguage();

  // State management
  const [mounted, setMounted] = useState(false);
  const [imagesLoaded, setImagesLoaded] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  // Mode: 'custom' or 'agent' for the new toggle
  const [mode, setMode] = useState<"custom" | "agent">("custom");

  // Preload background images and handle mounting state
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

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || isLoading) return;
    
    setIsLoading(true);
    console.log(t("creatorInput.sendMessage") + ":", inputValue);
    
    setTimeout(() => {
      router.push("/creator-area");
    }, 1000);
  };

  // Handle keyboard shortcuts
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as any);
    }
  };

  if (!mounted) return null;

  return (
    <div className="min-h-screen w-full h-full overflow-auto login-fantasy-bg relative flex flex-col items-center justify-center">
      {/* Yellow background layer with fade-in effect */}
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

      {/* Red background layer with multiply blend mode */}
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

      {/* Main content container */}
      <div className="flex flex-col items-center justify-center w-full max-w-4xl px-4 py-8 relative z-10">
        {/* Header section with animated title */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="text-center mb-12"
        >
          <h1 className={"text-3xl md:text-5xl font-bold mb-4 font-cinzel bg-clip-text text-transparent bg-gradient-to-r from-amber-500 via-orange-400 to-yellow-300 drop-shadow-[0_0_10px_rgba(251,146,60,0.5)]"}>
            {t("creatorInput.title")}
          </h1>
          <p className={`text-[#c0a480] text-sm md:text-base ${serifFontClass} italic`}>
            {t("creatorInput.subtitle")}
          </p>
        </motion.div>

        {/* Input form section */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.3 }}
          className="w-full max-w-2xl"
        >
          <form onSubmit={handleSubmit} className="relative">
            {/* Text input area with new structure */}
            <div className="relative bg-black/20 backdrop-blur-sm border border-amber-500/30 rounded-2xl p-1 shadow-[0_0_20px_rgba(251,146,60,0.3)] hover:shadow-[0_0_30px_rgba(251,146,60,0.4)] transition-all duration-300 min-h-[180px]">
              {/* Mode toggle button at top-right, single label, pill style */}
              <div className="absolute right-4 top-3 z-20 flex">
                <button
                  type="button"
                  className={`
                    relative flex items-center justify-center
                    w-[110px] h-8 rounded-full px-2
                    border border-amber-400/30 
                    backdrop-blur-md
                    transition-all duration-300
                    shadow-inner hover:shadow-[0_0_6px_rgba(251,146,60,0.3)]
                    ${mode === "agent" ? "text-black bg-gradient-to-r from-amber-400/90 via-yellow-300/80 to-amber-500/90 animate-gradient-x" : "text-amber-300 bg-gradient-to-r from-purple-300/30 via-violet-200/20 to-purple-400/30 animate-gradient-x"}
                  `}
                  onClick={() => setMode(mode === "custom" ? "agent" : "custom")}
                  disabled={isLoading}
                  style={{ minWidth: 120 }}
                >
                  {/* Only show one label at a time, centered */}
                  <span
                    className={`relative z-10 flex-1 text-xs font-cinzel text-center transition-all duration-300 font-bold
                      ${mode === "agent" ? "text-black" : "text-amber-400"}`}
                    style={{ width: 120 }}
                  >
                    {mode === "agent" ? "AGENT MODE" : "CUSTOM MODE"}
                  </span>
                </button>
              </div>

              {/* Textarea for user input, with increased height */}
              <textarea
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder={t("creatorInput.placeholder")}
                className={`w-full bg-transparent text-[#c0a480] placeholder-[#c0a480]/60 ${serifFontClass} resize-none border-0 outline-none p-4 pr-16 min-h-[120px] max-h-[320px] text-sm md:text-base`}
                disabled={isLoading}
              />

              {/* Button group at bottom-right */}
              <div className="absolute right-3 bottom-3 flex gap-2 z-10">
                {/* Clear button */}
                <button
                  type="button"
                  onClick={() => setInputValue("")}
                  disabled={isLoading || !inputValue}
                  className="p-2 bg-gradient-to-r from-amber-500 to-orange-400 text-black rounded-xl hover:from-amber-400 hover:to-orange-300 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-[0_0_10px_rgba(251,146,60,0.5)] hover:shadow-[0_0_15px_rgba(251,146,60,0.7)]"
                  title="Clear"
                >
                  {/* Trash icon (Lucide) */}
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z" /></svg>
                </button>
                {/* Submit button with loading state */}
                <button
                  type="submit"
                  disabled={!inputValue.trim() || isLoading}
                  className="p-2 bg-gradient-to-r from-amber-500 to-orange-400 text-black rounded-xl hover:from-amber-400 hover:to-orange-300 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-[0_0_10px_rgba(251,146,60,0.5)] hover:shadow-[0_0_15px_rgba(251,146,60,0.7)]"
                  title="Send"
                >
                  {isLoading ? (
                    <Sparkles className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                </button>
              </div>

              {/* Helper text and character count at bottom-left */}
              <div className="absolute left-4 bottom-3 flex flex-col gap-1 z-10">
                <span className={`text-[#c0a480]/60 text-xs ${fontClass}`}>{t("creatorInput.enterToSend")}</span>
                <span className="text-[#c0a480]/60 text-xs font-cinzel">{inputValue.length}/1000</span>
              </div>
            </div>

            {/* Example stories helper below input box */}
            <div className="flex justify-between items-center mt-3 px-2">
              <span className={`text-[#c0a480]/60 text-xs ${fontClass}`}>{t("creatorInput.exampleStories")}</span>
            </div>
          </form>
        </motion.div>
      </div>
    </div>
  );
}
