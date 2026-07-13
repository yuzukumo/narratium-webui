import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./styles/local-fonts.css";
import "./styles/fonts.css";
import MainLayout from "@/components/MainLayout";
import { LanguageProvider } from "@/app/i18n/LanguageProvider";
import { SoundProvider } from "@/contexts/SoundContext";
import { AuthProvider } from "@/contexts/AuthContext";
import AuthGate from "@/components/AuthGate";
import { ModelProvider } from "@/contexts/ModelContext";
import AppToaster from "@/components/AppToaster";

// Define viewport configuration
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export const metadata: Metadata = {
  title: "Narratium",
  description: "A self-hosted AI character roleplay and story workspace.",
  applicationName: "Narratium",
  keywords: ["AI character chat", "interactive storytelling", "self-hosted", "story workspace"],
  authors: [{
    name: "Narratium contributors",
    url: "https://github.com/yuzukumo/narratium-webui",
  }],
  openGraph: {
    title: "Narratium",
    description: "A self-hosted AI character roleplay and story workspace.",
    type: "website",
    locale: "en_US",
    alternateLocale: "zh_CN",
    siteName: "Narratium",
  },
  twitter: {
    card: "summary",
    title: "Narratium",
    description: "A self-hosted AI character roleplay and story workspace.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  icons: {
    icon: [
      { url: "/icon.ico", sizes: "any" },
    ],
    apple: [
      { url: "/icon.ico", sizes: "180x180" },
      { url: "/icon.ico", sizes: "152x152" },
      { url: "/icon.ico", sizes: "120x120" },
    ],
    shortcut: { url: "/icon.ico" },
    other: [
      {
        rel: "mask-icon",
        url: "/icon.ico",
      },
    ],
  },
};

export default function RootLayout({
  children,
}: { children: React.ReactNode }) {
  return (
    <html lang="zh" className="h-full">
      <body className="h-full bg-[#171717] text-white">
        <LanguageProvider>
          <AuthProvider>
            <AuthGate>
              <SoundProvider>
                <ModelProvider>
                  <AppToaster />
                  <MainLayout>{children}</MainLayout>
                </ModelProvider>
              </SoundProvider>
            </AuthGate>
          </AuthProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
