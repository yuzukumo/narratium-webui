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
 * - Background images: background_yellow.webp, background_red.webp
 */

"use client";

export default function CreatorAreaPage() {
  return (
    <div className="min-h-screen w-full h-full overflow-auto login-fantasy-bg relative flex flex-col items-center justify-center">
      {/* Yellow background layer with fade-in effect */}
      <div
        className="absolute inset-0 z-0 opacity-35"
        style={{
          backgroundImage: "url('/background_yellow.webp')",
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        }}
      />

      {/* Red background layer with multiply blend mode */}
      <div
        className="absolute inset-0 z-1 opacity-45"
        style={{
          backgroundImage: "url('/background_red.webp')",
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
          mixBlendMode: "multiply",
        }}
      />

      {/* Main content container with animated text */}
      <div className="flex flex-col items-center justify-center w-full py-8 relative z-10">
        <div
          className="ui-enter-up text-3xl md:text-5xl font-bold mb-6 font-cinzel bg-clip-text text-transparent bg-gradient-to-r from-amber-500 via-orange-400 to-yellow-300 drop-shadow-[0_0_10px_rgba(251,146,60,0.5)]"
        >
          Coming Soon
        </div>

        <p
          style={{ animationDelay: "200ms" }}
          className="ui-enter-up text-[#c0a480] text-sm md:text-base font-cinzel"
        >
          waiting for the next fun time
        </p>
      </div>
    </div>
  );
}
