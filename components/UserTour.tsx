"use client";

import { useState, useEffect, useRef } from "react";
import { useLanguage } from "@/app/i18n";

interface TourStep {
  target: string;
  title: string;
  content: string;
  position: "top" | "bottom" | "left" | "right";
  allowSkip?: boolean;
  isLanguageSelection?: boolean;
}

interface UserTourProps {
  steps: TourStep[];
  isVisible: boolean;
  onComplete: () => void;
  onSkip: () => void;
}

export default function UserTour({ steps, isVisible, onComplete, onSkip }: UserTourProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const { t, serifFontClass, setLanguage, language } = useLanguage();

  useEffect(() => {
    if (currentStep > 0 && steps[0]?.isLanguageSelection) {
      setCurrentStep(1);
    }
  }, [language]);
  const overlayRef = useRef<HTMLDivElement>(null);
  const originalScrollPos = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (isVisible) {
      originalScrollPos.current = {
        x: window.scrollX,
        y: window.scrollY,
      };
      
      document.body.style.overflow = "hidden";
      document.body.style.position = "relative";
    } else {
      document.body.style.overflow = "";
      document.body.style.position = "";
      
      if (originalScrollPos.current) {
        window.scrollTo(originalScrollPos.current.x, originalScrollPos.current.y);
        originalScrollPos.current = null;
      }
    }

    return () => {
      document.body.style.overflow = "";
      document.body.style.position = "";
    };
  }, [isVisible]);

  useEffect(() => {
    if (!isVisible || currentStep >= steps.length) return;

    const updateTargetPosition = () => {
      const target = document.querySelector(steps[currentStep].target);
      if (target) {
        const rect = target.getBoundingClientRect();
        setTargetRect(rect);

        if (steps[currentStep].target !== "body") {
          const viewportHeight = window.innerHeight;
          const viewportWidth = window.innerWidth;
          const elementTop = rect.top;
          const elementBottom = rect.bottom;
          const elementLeft = rect.left;
          const elementRight = rect.right;
          
          const isVisible = (
            elementTop >= 0 &&
            elementLeft >= 0 &&
            elementBottom <= viewportHeight &&
            elementRight <= viewportWidth
          );
          
          if (!isVisible) {
            target.scrollIntoView({ 
              behavior: "smooth", 
              block: "center", 
              inline: "center", 
            });
          }
        }
      }
    };

    const delay = steps[currentStep].target === "body" ? 100 : 50;

    const rafId = requestAnimationFrame(() => {
      if (!targetRect) {
        setTimeout(updateTargetPosition, delay);
      } else {
        updateTargetPosition();
      }
    });

    window.addEventListener("resize", updateTargetPosition);

    return () => {
      window.removeEventListener("resize", updateTargetPosition);
      cancelAnimationFrame(rafId);
    };
  }, [currentStep, steps, isVisible]);

  const nextStep = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      onComplete();
    }
  };

  const prevStep = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const skipTour = () => {
    onSkip();
  };

  if (!isVisible || currentStep >= steps.length || !targetRect) {
    return null;
  };

  const currentStepData = steps[currentStep];

  const getTooltipPosition = () => {
    const tooltipWidth = Math.min(320, window.innerWidth - 32);
    const tooltipHeight = 200;
    const margin = 20;
    const minDistanceFromTarget = 50;

    if (currentStepData.target === "body") {
      return {
        top: (window.innerHeight - tooltipHeight) / 2,
        left: (window.innerWidth - tooltipWidth) / 2,
      };
    }

    const isNearTop = targetRect.top < window.innerHeight * 0.2;
    const isNearBottom = targetRect.bottom > window.innerHeight * 0.8;
    const isNearLeft = targetRect.left < window.innerWidth * 0.2;
    const isNearRight = targetRect.right > window.innerWidth * 0.8;

    let top = 0;
    let left = 0;
    let adjustedPosition = currentStepData.position;

    if (isNearTop && (currentStepData.position === "top")) {
      adjustedPosition = "bottom";
    }
    if (isNearBottom && (currentStepData.position === "bottom")) {
      adjustedPosition = "top";
    }
    if (isNearLeft && (currentStepData.position === "left")) {
      adjustedPosition = "right";
    }
    if (isNearRight && (currentStepData.position === "right" || currentStepData.position === "left")) {
      adjustedPosition = "bottom";
    }

    switch (adjustedPosition) {
    case "top":
      top = targetRect.top - tooltipHeight - minDistanceFromTarget;
      left = targetRect.left + (targetRect.width - tooltipWidth) / 2;
      break;
    case "bottom":
      top = targetRect.bottom + minDistanceFromTarget;
      left = targetRect.left + (targetRect.width - tooltipWidth) / 2;
      break;
    case "left":
      top = targetRect.top + (targetRect.height - tooltipHeight) / 2;
      left = targetRect.left - tooltipWidth - minDistanceFromTarget;
      break;
    case "right":
      top = targetRect.top + (targetRect.height - tooltipHeight) / 2;
      left = targetRect.right + minDistanceFromTarget;
      break;
    }

    const viewportPadding = 30;
    
    if (top < viewportPadding) {
      if (adjustedPosition === "top") {
        top = targetRect.bottom + minDistanceFromTarget;
      }
    }
    
    if (top + tooltipHeight > window.innerHeight - viewportPadding) {
      if (adjustedPosition === "bottom") {
        top = targetRect.top - tooltipHeight - minDistanceFromTarget;
      }
    }
    
    if (left < viewportPadding) {
      if (adjustedPosition === "left") {
        left = targetRect.right + minDistanceFromTarget;
      }
    }
    
    if (left + tooltipWidth > window.innerWidth - viewportPadding) {  
      if (adjustedPosition === "right") {
        left = targetRect.left - tooltipWidth - minDistanceFromTarget;
      }
      if (left < viewportPadding) {
        left = (window.innerWidth - tooltipWidth) / 2;
      }
    }

    top = Math.max(viewportPadding, Math.min(top, window.innerHeight - tooltipHeight - viewportPadding));
    left = Math.max(viewportPadding, Math.min(left, window.innerWidth - tooltipWidth - viewportPadding));

    return { top, left };
  };

  const tooltipPosition = getTooltipPosition();

  return (
    <div className="fixed inset-0 z-[9999] pointer-events-auto">
      <div 
        ref={overlayRef}
        className="absolute inset-0 bg-black bg-opacity-75 pointer-events-none"
        style={{
          background: currentStepData.target === "body" 
            ? "rgba(0, 0, 0, 0.75)"
            : `
              radial-gradient(
                circle at ${targetRect.left + targetRect.width / 2}px ${targetRect.top + targetRect.height / 2}px,
                transparent ${Math.max(targetRect.width, targetRect.height) / 2 + 10}px,
                rgba(0, 0, 0, 0.8) ${Math.max(targetRect.width, targetRect.height) / 2 + 20}px
              )
            `,
        }}
      />

      {currentStepData.target !== "body" && (
        <div
          className="absolute border-2 border-[#f9c86d] rounded-lg shadow-lg pointer-events-none"
          style={{
            top: targetRect.top - 4,
            left: targetRect.left - 4,
            width: targetRect.width + 8,
            height: targetRect.height + 8,
            boxShadow: "0 0 20px rgba(249, 200, 109, 0.6)",
          }}
        />
      )}

      <div
        className="absolute bg-[#2a261f] border border-[#534741] rounded-lg shadow-2xl p-6 max-w-sm pointer-events-auto transition-all duration-300 opacity-100"
        style={{
          top: tooltipPosition.top,
          left: tooltipPosition.left,
          width: Math.min(320, window.innerWidth - 32),
          maxWidth: "calc(100vw - 32px)",
          boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.3), 0 10px 10px -5px rgba(0, 0, 0, 0.1)",
          // 增加渐变效果属性
          transform: "scale(1)",
          opacity: targetRect ? 1 : 0,
        }}
      >
        <div className="mb-4">
          <h3 className={`text-lg font-semibold text-[#f4e8c1] mb-2 ${serifFontClass}`}>
            {currentStepData.title}
          </h3>
          <p className={`text-[#c0a480] text-sm leading-relaxed ${serifFontClass}`}>
            {currentStepData.content}
          </p>
        </div>

        <div className="flex items-center justify-between mb-4">
          <div className="flex space-x-1">
            {steps.map((_, index) => (
              <div
                key={index}
                className={`w-2 h-2 rounded-full ${
                  index === currentStep ? "bg-[#f9c86d]" : 
                    index < currentStep ? "bg-[#c0a480]" : "bg-[#534741]"
                }`}
              />
            ))}
          </div>
          <span className={`text-xs text-[#a18d6f] ${serifFontClass}`}>
            {currentStep + 1} / {steps.length}
          </span>
        </div>

        <div className="flex justify-between">
          <div className="flex space-x-2">
            {currentStep > 0 && (
              <button
                onClick={prevStep}
                className={`px-3 py-1.5 text-sm bg-[#1a1816] text-[#c0a480] border border-[#534741] rounded hover:bg-[#252220] hover:text-[#f4e8c1] transition-colors ${serifFontClass}`}
              >
                {t("tour.previous") || "上一步"}
              </button>
            )}
            {currentStepData.allowSkip !== false && (
              <button
                onClick={skipTour}
                className={`px-3 py-1.5 text-sm text-[#a18d6f] hover:text-[#c0a480] transition-colors ${serifFontClass}`}
              >
                {t("tour.skip") || "跳过"}
              </button>
            )}
          </div>
          
          {/* Language selection buttons */}
          {currentStepData.isLanguageSelection ? (
            <div className="flex space-x-3">
              <button
                onClick={() => {
                  setLanguage("zh");
                  document.documentElement.lang = "zh";
                  localStorage.setItem("language", "zh");
                  nextStep();
                }}
                className={`px-4 py-1.5 text-sm bg-[#f9c86d] text-[#1a1816] rounded hover:bg-[#c0a480] transition-colors font-medium ${serifFontClass}`}
              >
                中文
              </button>
              <button
                onClick={() => {
                  setLanguage("en");
                  document.documentElement.lang = "en";
                  localStorage.setItem("language", "en");
                  nextStep();
                }}
                className={`px-4 py-1.5 text-sm bg-[#f9c86d] text-[#1a1816] rounded hover:bg-[#c0a480] transition-colors font-medium ${serifFontClass}`}
              >
                English
              </button>
            </div>
          ) : (
            <button
              onClick={nextStep}
              className={`px-4 py-1.5 text-sm bg-[#f9c86d] text-[#1a1816] rounded hover:bg-[#c0a480] transition-colors font-medium ${serifFontClass}`}
            >
              {currentStep === steps.length - 1 
                ? (t("tour.finish") || "完成") 
                : (t("tour.next") || "下一步")
              }
            </button>
          )}
        </div>
      </div>
    </div>
  );
} 
