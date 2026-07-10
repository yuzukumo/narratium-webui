"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { useLanguage } from "./i18n";
import "./styles/fantasy-ui.css";

export default function NotFound() {
  const { t, fontClass, titleFontClass, serifFontClass } = useLanguage();

  return (
    <div className="flex flex-col items-center justify-center min-h-screen login-fantasy-bg">
      <div
        className="absolute inset-0 z-0 opacity-35"
        style={{
          backgroundImage: "url('/background_yellow.png')",
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        }}
      />

      <div
        className="absolute inset-0 z-1 opacity-45"
        style={{
          backgroundImage: "url('/background_red.png')",
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
          mixBlendMode: "multiply",
        }}
      />

      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-10 left-10 opacity-5">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2L15 8H21L16 12L18 18L12 14L6 18L8 12L3 8H9L12 2Z" fill="#f9c86d" />
          </svg>
        </div>
        <div className="absolute top-20 right-20 opacity-5">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M10 0L12 6H18L13 10L15 16L10 12L5 16L7 10L2 6H8L10 0Z" fill="#f9c86d" />
          </svg>
        </div>
        <div className="absolute bottom-20 left-1/4 opacity-5">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M8 0C3.6 0 0 3.6 0 8C0 12.4 3.6 16 8 16C12.4 16 16 12.4 16 8C16 3.6 12.4 0 8 0ZM8 2C11.3 2 14 4.7 14 8C14 11.3 11.3 14 8 14C4.7 14 2 11.3 2 8C2 4.7 4.7 2 8 2Z" fill="#85c5e3" />
          </svg>
        </div>
        <div className="absolute bottom-10 right-1/4 opacity-5">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 0C5.4 0 0 5.4 0 12C0 18.6 5.4 24 12 24C18.6 24 24 18.6 24 12C24 5.4 18.6 0 12 0ZM12 4C16.4 4 20 7.6 20 12C20 16.4 16.4 20 12 20C7.6 20 4 16.4 4 12C4 7.6 7.6 4 12 4Z" fill="#a18d6f" />
          </svg>
        </div>
      </div>

      <div className="relative z-10 w-full max-w-2xl px-6 py-12 text-center">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <div className="mb-8 relative">
            <div className="relative mx-auto w-32 h-32 flex items-center justify-center">
              <div className="absolute inset-0 rounded-full border-2 border-[#534741] opacity-20"></div>
              <div className="absolute inset-4 rounded-full border-2 border-[#534741] opacity-30"></div>
              <div className="absolute inset-8 rounded-full border-2 border-[#534741] opacity-40"></div>
              <span className={`text-5xl font-bold text-[#c0a480] ${titleFontClass}`}>404</span>
            </div>
          </div>

          <h1 className={`text-3xl mb-3 text-[#eae6db] magical-login-text ${serifFontClass}`}>
            {t("notFound.title")}
          </h1>
          <h2 className={`text-xl mb-6 text-[#c0a480] ${serifFontClass}`}>
            {t("notFound.subtitle")}
          </h2>

          <p className={`mb-10 text-[#a18d6f] ${fontClass}`}>
            {t("notFound.message")}
          </p>

          <div className="flex items-center justify-center space-x-4">
            <Link href="/">
              <motion.div
                className={`portal-button text-[#c0a480] hover:text-[#ffd475] px-4 py-2 text-sm border border-[#534741] rounded-md cursor-pointer ${fontClass}`}
                whileHover={{ scale: 1.05 }}
                transition={{ type: "spring", stiffness: 400, damping: 10 }}
              >
                {t("notFound.backToHome")}
              </motion.div>
            </Link>
            <span className="mx-1 text-[#534741]">•</span>
            <div className={`text-xs text-[#a18d6f] ${fontClass}`}>
              {t("notFound.exploreMore")}
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
