/**
 * Main layout component for the Narratium application
 * 
 * This component provides the core layout structure including:
 * - Responsive sidebar navigation
 * - Model settings sidebar
 * - Login modal integration
 * - Settings dropdown
 * - Mobile responsiveness handling
 * 
 * The layout uses a fantasy-themed UI with dynamic sidebar states
 * and responsive design considerations.
 * 
 * Dependencies:
 * - Sidebar: Main navigation component
 * - ModelSidebar: Model settings panel
 * - SettingsDropdown: Global settings menu
 * - LoginModal: Authentication modal
 */

"use client";

import { useEffect, useRef, useState } from "react";
import Sidebar from "@/components/Sidebar";
import ModelSidebar from "@/components/ModelSidebar";
import SettingsDropdown from "@/components/SettingsDropdown";
import LoginModal from "@/components/LoginModal";
import "@/app/styles/fantasy-ui.css";

/**
 * Main layout wrapper component that manages the application's core structure
 * 
 * @param {Object} props - Component props
 * @param {React.ReactNode} props.children - Child components to be rendered in the main content area
 * @returns {JSX.Element} The complete layout structure with sidebars and content area
 */
export default function MainLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [modelSidebarOpen, setModelSidebarOpen] = useState(false);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [hideSettingsButton, setHideSettingsButton] = useState(false);
  const lastIsMobileRef = useRef<boolean | null>(null);

  useEffect(() => {
    const checkIfMobile = () => {
      const mobile = window.innerWidth < 768;
      const previousMobile = lastIsMobileRef.current;

      setIsMobile(mobile);

      if (previousMobile === null) {
        const storedSidebarState = window.localStorage.getItem("sidebarState");
        setSidebarOpen(mobile ? false : storedSidebarState !== "closed");
      } else if (previousMobile !== mobile) {
        const storedSidebarState = window.localStorage.getItem("sidebarState");
        setSidebarOpen(mobile ? false : storedSidebarState !== "closed");

        if (mobile) {
          setModelSidebarOpen(false);
        }
      }

      lastIsMobileRef.current = mobile;
    };

    checkIfMobile();
    setMounted(true);
    
    window.addEventListener("resize", checkIfMobile);
    
    return () => window.removeEventListener("resize", checkIfMobile);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleCharacterViewChange = (event: Event) => {
      const nextHide = (event as CustomEvent<{ hideSettings?: boolean }>).detail?.hideSettings === true;
      setHideSettingsButton(nextHide);
      if (nextHide) {
        setModelSidebarOpen(false);
      }
    };

    window.addEventListener("narratium:character-view-change", handleCharacterViewChange as EventListener);

    return () => {
      window.removeEventListener("narratium:character-view-change", handleCharacterViewChange as EventListener);
    };
  }, []);

  const toggleSidebar = () => {
    setSidebarOpen((current) => {
      const nextOpen = !current;
      if (typeof window !== "undefined") {
        window.localStorage.setItem("sidebarState", nextOpen ? "open" : "closed");
      }
      return nextOpen;
    });
  };

  const toggleModelSidebar = () => {
    setModelSidebarOpen(!modelSidebarOpen);
  };

  if (!mounted) {
    return null;
  }

  return (
    <div className="flex h-full overflow-hidden fantasy-bg relative"> 
      <LoginModal 
        isOpen={isLoginModalOpen} 
        onClose={() => setIsLoginModalOpen(false)} 
      />
      <div className="fixed left-0 top-0 h-full z-10">
        <Sidebar
          isOpen={sidebarOpen}
          toggleSidebar={toggleSidebar}
          openLoginModal={() => setIsLoginModalOpen(true)}
        />
      </div>
      <main
        className={`flex-1 h-full overflow-y-auto overflow-x-hidden transition-all duration-300
            ${isMobile ? "ml-0 mr-0" : `${sidebarOpen ? "ml-72" : "ml-16"} ${modelSidebarOpen ? "mr-72" : "mr-0"}`}
          `}
      >
        <div className="h-full min-w-0 relative overflow-x-hidden">
          {!hideSettingsButton && (
            <div className="fixed top-3 right-3 z-20 md:absolute md:top-4 md:right-4 md:z-[999]">
              <SettingsDropdown
                toggleModelSidebar={toggleModelSidebar}
                openLoginModal={() => setIsLoginModalOpen(true)}
              />
            </div>
          )}

          {children}
        </div>
      </main>

      {isMobile && modelSidebarOpen && (
        <button
          type="button"
          aria-label="Close model settings"
          onClick={toggleModelSidebar}
          className="fixed inset-0 z-30 bg-black/45 backdrop-blur-[1px]"
        />
      )}

      <div className="fixed right-0 top-0 h-full z-40">
        <ModelSidebar isOpen={modelSidebarOpen} toggleSidebar={toggleModelSidebar} />
      </div>
    </div>
  );
}
