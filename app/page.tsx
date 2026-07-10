/**
 * Main landing page component for Narratium
 * 
 * This file contains the home page implementation with the following features:
 * - Animated landing page with fantasy-themed UI
 * - Multi-language support
 * - User tour functionality for first-time visitors
 * - Responsive design with mobile support
 * 
 * Dependencies:
 * - framer-motion: For animations
 * - next/link: For client-side navigation
 * - Custom hooks: useLanguage, useTour
 */

import { homeMetadata } from "./metadata";
export const metadata = homeMetadata;

import { Suspense } from "react";
import HomeContent from "@/components/HomeContent";
import "./styles/fantasy-ui.css";

/**
 * Loading component shown while the main content is being loaded
 * Displays an animated loading spinner with fantasy-themed styling
 * 
 * @returns {JSX.Element} The loading screen component
 */
function HomeLoading() {
  return (
    <div className="flex flex-col items-center justify-center h-full login-fantasy-bg relative">
      <div className="relative z-20 flex justify-center items-center h-screen">
        <div className="relative w-16 h-16">
          <div className="absolute inset-0 rounded-full border-2 border-t-[#f9c86d] border-r-[#c0a480] border-b-[#a18d6f] border-l-transparent animate-spin"></div>
          <div className="absolute inset-2 rounded-full border-2 border-t-[#a18d6f] border-r-[#f9c86d] border-b-[#c0a480] border-l-transparent animate-spin-slow"></div>
        </div>
      </div>
    </div>
  );
}

/**
 * Root component that wraps the home page content with Suspense
 * Provides fallback loading state while content is being loaded
 * 
 * @returns {JSX.Element} The complete home page with loading state handling
 */
export default function Home() {
  return (
    <Suspense fallback={<HomeLoading />}>
      <HomeContent />
    </Suspense>
  );
}
