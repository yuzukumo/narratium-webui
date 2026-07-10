"use client";

import { ReactNode } from "react";
import { useLanguage } from "./index";

interface FontWrapperProps {
  children: ReactNode;
}

export function FontWrapper({ children }: FontWrapperProps) {
  const { fontClass } = useLanguage();
  
  return (
    <div className={fontClass}>
      {children}
    </div>
  );
}

export function TitleFontWrapper({ children }: FontWrapperProps) {
  const { titleFontClass } = useLanguage();
  
  return (
    <div className={titleFontClass}>
      {children}
    </div>
  );
}
