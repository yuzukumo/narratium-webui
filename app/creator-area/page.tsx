/**
 * Creator Area Page Component
 * 
 * This is a placeholder page that displays a "Coming Soon" message with:
 * - Animated background effects
 * - Gradient text styling
 * - Responsive design
 * - Image preloading for smooth transitions
 * 
 * The page serves as a temporary landing page for features that are
 * under development or planned for future release.
 * 
 * Dependencies:
 * - framer-motion: For animation effects
 * - Background images: background_yellow.png, background_red.png
 */

"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";

export default function CreatorAreaPage() {
  // State for handling component mounting and image loading
  const [mounted, setMounted] = useState(false);
  const [imagesLoaded, setImagesLoaded] = useState(false);

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

      {/* Main content container with animated text */}
      <div className="flex flex-col items-center justify-center w-full py-8 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="text-3xl md:text-5xl font-bold mb-6 font-cinzel bg-clip-text text-transparent bg-gradient-to-r from-amber-500 via-orange-400 to-yellow-300 drop-shadow-[0_0_10px_rgba(251,146,60,0.5)]"
        >
          Coming Soon
        </motion.div>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="text-[#c0a480] text-sm md:text-base font-cinzel"
        >
          waiting for the next fun time
        </motion.p>
      </div>
    </div>
  );
}
