"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import UserMenu from "@/components/UserMenu";
import "@/app/styles/fantasy-ui.css";

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
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
      }

      lastIsMobileRef.current = mobile;
    };

    checkIfMobile();
    setMounted(true);
    
    window.addEventListener("resize", checkIfMobile);
    
    return () => window.removeEventListener("resize", checkIfMobile);
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

  if (!mounted) {
    return null;
  }

  const chatOwnsScroll = pathname === "/character";

  return (
    <div className="flex h-full overflow-hidden fantasy-bg relative"> 
      <div className="fixed left-0 top-0 h-full z-10">
        <Sidebar
          isOpen={sidebarOpen}
          isMobile={isMobile}
          toggleSidebar={toggleSidebar}
        />
      </div>
      <main
        className={`h-full min-h-0 flex-1 overflow-x-hidden transition-all duration-300 ${chatOwnsScroll ? "overflow-hidden" : "overflow-y-auto"}
            ${isMobile ? "ml-0" : sidebarOpen ? "ml-72" : "ml-16"}
          `}
      >
        <div className="relative h-full min-h-0 min-w-0 overflow-x-hidden">
          {isMobile && (
            <div className="fixed right-3 top-3 z-[70]">
              <UserMenu compact mobile placement="bottom" />
            </div>
          )}

          {children}
        </div>
      </main>
    </div>
  );
}
