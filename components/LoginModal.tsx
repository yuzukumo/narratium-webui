"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLanguage } from "@/app/i18n";
import { getStoredUserSession, persistUserSession } from "@/utils/user-session";

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function LoginModal({ isOpen, onClose }: LoginModalProps) {
  const { t,  fontClass, titleFontClass, serifFontClass } = useLanguage();
  const [activeTab, setActiveTab] = useState("password");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [step, setStep] = useState(1);
  const [showQuestion, setShowQuestion] = useState(true);

  const modalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen, step, showQuestion]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const { username: storedUsername } = getStoredUserSession();
    setActiveTab("password");
    setUsername(storedUsername);
    setPassword("");
    setVerificationCode("");
    setError("");
    setStep(1);
    setShowQuestion(true);
  }, [isOpen]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleEscape);
    }
    
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen, onClose]);

  const questions = [
    {
      id: 1,
      text: t("auth.wizardQuestion").replace("邮箱", "名称"),
      placeholder: t("auth.emailPlaceholder").replace("邮箱", "名称"),
    },
    {
      id: 2,
      text: activeTab === "password"
        ? t("auth.spellQuestion")
        : t("auth.codeQuestion"),
      placeholder: activeTab === "password"
        ? t("auth.passwordPlaceholder")
        : t("auth.codePlaceholder"),
    },
  ];

  const currentQuestion = questions.find(q => q.id === step) || questions[0];

  const handleNext = () => {
    if (step < questions.length) {
      setShowQuestion(false);
      setTimeout(() => {
        setStep(step + 1);
        setShowQuestion(true);
      }, 300);
    }
  };

  const handlePrev = () => {
    if (step > 1) {
      setShowQuestion(false);
      setTimeout(() => {
        setStep(step - 1);
        setShowQuestion(true);
      }, 300);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();

      if (username.trim() !== "") {
        handleLogin(e as unknown as React.FormEvent);
      }
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { value } = e.target;

    switch (step) {
    case 1:
      setUsername(value);
      break;
    case 2:
      if (activeTab === "password") {
        setPassword(value);
      } else {
        setVerificationCode(value);
      }
      break;
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!username.trim()) {
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      persistUserSession(username);

      onClose();
      setStep(1);
      setUsername("");
      setPassword("");
      setVerificationCode("");
    } catch (err) {
      console.error("Login error:", err);
      setError("登录失败，请重试");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendVerificationCode = () => {
    if (!username.trim()) {
      setError("请输入名称");
      return;
    }
  };

  const renderInput = () => {
    const placeholder = currentQuestion.placeholder;

    return (
      <div className="relative w-full">
        <input
          ref={inputRef}
          type={step === 2 && activeTab === "password" ? "password" : "text"}
          className={`bg-transparent border-0 outline-none w-full text-center text-lg text-[#eae6db] placeholder-[#a18d6f] shadow-none focus:ring-0 focus:border-0 ${serifFontClass}`}
          placeholder={placeholder}
          value={step === 1 ? username : (activeTab === "password" ? password : verificationCode)}
          onChange={handleInputChange}
          onKeyDown={handleKeyPress}
          disabled={isLoading}
          autoComplete="off"
          style={{
            caretColor: "#f9c86d",
            caretShape: "bar",
            background: "transparent",
            boxShadow: "none",
            border: "none",
            borderWidth: "0",
            borderColor: "transparent",
            letterSpacing: "0.05em",
          }}
        />
        <div className="absolute bottom-0 left-1/2 transform -translate-x-1/2 w-32 h-0.5 opacity-0 group-focus-within:opacity-100 transition-opacity duration-300">
          <div className="w-full h-full bg-gradient-to-r from-transparent via-[#c0a480] to-transparent"></div>
        </div>
      </div>
    );
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center">
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            ref={modalRef}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ type: "spring", damping: 20, stiffness: 300 }}
            className="fantasy-bg bg-opacity-75 border border-[#534741] rounded-lg shadow-lg p-8 w-full max-w-md relative z-10 backdrop-filter backdrop-blur-sm"
          >
            <button 
              onClick={onClose}
              className="absolute top-4 right-4 text-[#a18d6f] hover:text-[#f9c86d] transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
            <div className="text-center mb-6">
              <h1 className={"text-3xl font-bold text-[#f9c86d] mb-2 font-cinzel"}>Welcome Back</h1>
              <p className={`text-[#c0a480] ${serifFontClass}`}>{t("auth.continueJourney")}</p>
            </div>

            {error && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-[#a18d6f] text-sm text-center mb-4"
              >
                {error}
              </motion.div>
            )}

            <form onSubmit={handleLogin} className="w-full">
              <AnimatePresence mode="wait">
                {showQuestion && (
                  <motion.div
                    key={`question-${step}-${activeTab}`}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    transition={{ duration: 0.4, ease: "easeOut" }}
                    className="text-center"
                  >
                    <h2 
                      className={`text-xl magical-login-text mb-8 tracking-wide ${serifFontClass}`}
                      dangerouslySetInnerHTML={{
                        __html: currentQuestion.text
                          .replace("✨", "<span>✨</span>")
                          .replace("🔮", "<span>🔮</span>")
                          .replace("⚡", "<span>⚡</span>"),
                      }}
                    />

                    <div className="magical-input min-h-[100px] flex items-center justify-center">
                      {renderInput()}
                      <div className="absolute bottom-0 left-1/2 transform -translate-x-1/2 w-32 h-1 opacity-0 transition-opacity duration-300 magical-input-glow"></div>
                    </div>

                    {step === 2 && activeTab === "code" && (
                      <motion.button
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        type="button"
                        className={`mt-4 portal-button text-sm ${fontClass}`}
                        onClick={handleSendVerificationCode}
                      >
                        {t("auth.getCode")}
                      </motion.button>
                    )}

                    {isLoading && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className={`mt-8 text-[#c0a480] ${serifFontClass}`}
                      >
                        <span className="inline-block animate-pulse">✨</span> {t("auth.openingMagicDoor")}
                      </motion.div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* <div className="flex justify-center mt-6">
                <button
                  type="button"
                  className={`px-3 py-1 mx-2 text-xs portal-button ${activeTab === "password" ? "text-[#f9c86d]" : "text-[#a18d6f]"} transition-colors ${fontClass}`}
                  onClick={() => {
                    setActiveTab("password");
                    if (step === 2) {
                      setShowQuestion(false);
                      setTimeout(() => {
                        setShowQuestion(true);
                      }, 300);
                    }
                  }}
                >
                  {t("auth.magicSpell")}
                </button>
                <button
                  type="button"
                  className={`px-3 py-1 mx-2 text-xs portal-button ${activeTab === "code" ? "text-[#f9c86d]" : "text-[#a18d6f]"} transition-colors ${fontClass}`}
                  onClick={() => {
                    setActiveTab("code");
                    if (step === 2) {
                      setShowQuestion(false);
                      setTimeout(() => {
                        setShowQuestion(true);
                      }, 300);
                    }
                  }}
                >
                  {t("auth.starCode")}
                </button>
              </div> */}

              <div className={`text-center mt-8 text-xs text-[#a18d6f] ${fontClass}`}>
                <p>{t("auth.agreementText")}</p>
                <div className="flex justify-center space-x-2 mt-1">
                  <a href="#" className="text-[#c0a480] hover:text-[#f9c86d] transition-colors">{t("auth.termsOfService")}</a>
                  <span>•</span>
                  <a href="#" className="text-[#c0a480] hover:text-[#f9c86d] transition-colors">{t("auth.privacyPolicy")}</a>
                </div>
              </div>

              <div className="flex justify-center mt-8">
                <div className="flex space-x-4">
                  <button type="button" className="w-10 h-10 rounded-full flex items-center justify-center border border-[#333333] bg-[#1a1a1a] hover:bg-[#252525] transition-colors">
                    <svg className="w-5 h-5" aria-hidden="true" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12.545 10.239v3.821h5.445c-.712 2.315-2.647 3.972-5.445 3.972a6.033 6.033 0 110-12.064c1.498 0 2.866.549 3.921 1.453l2.814-2.814A9.969 9.969 0 0012.545 2C7.021 2 2.543 6.477 2.543 12s4.478 10 10.002 10c8.396 0 10.249-7.85 9.426-11.748l-9.426-.013z"></path>
                    </svg>
                  </button>
                  <button type="button" className="w-10 h-10 rounded-full flex items-center justify-center border border-[#333333] bg-[#1a1a1a] hover:bg-[#252525] transition-colors">
                    <svg className="w-5 h-5" aria-hidden="true" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M23.954 4.569c-.885.389-1.83.654-2.825.775 1.014-.611 1.794-1.574 2.163-2.723-.951.555-2.005.959-3.127 1.184-.896-.959-2.173-1.559-3.591-1.559-2.717 0-4.92 2.203-4.92 4.917 0 .39.045.765.127 1.124C7.691 8.094 4.066 6.13 1.64 3.161c-.427.722-.666 1.561-.666 2.475 0 1.71.87 3.213 2.188 4.096-.807-.026-1.566-.248-2.228-.616v.061c0 2.385 1.693 4.374 3.946 4.827-.413.111-.849.171-1.296.171-.314 0-.615-.03-.916-.086.631 1.953 2.445 3.377 4.604 3.417-1.68 1.319-3.809 2.105-6.102 2.105-.39 0-.779-.023-1.17-.067 2.189 1.394 4.768 2.209 7.557 2.209 9.054 0 14-7.503 14-14 0-.21-.005-.42-.015-.63.961-.689 1.8-1.56 2.46-2.548l-.047-.02z"></path>
                    </svg>
                  </button>
                  <button type="button" className="w-10 h-10 rounded-full flex items-center justify-center border border-[#333333] bg-[#1a1a1a] hover:bg-[#252525] transition-colors">
                    <svg className="w-5 h-5" aria-hidden="true" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"></path>
                    </svg>
                  </button>
                </div>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
