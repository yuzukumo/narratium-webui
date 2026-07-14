"use client";

import { useEffect, useState } from "react";

export const MOBILE_VIEWPORT_QUERY = "(max-width: 767px)";

export function useMediaQuery(query: string): boolean | null {
  const [matches, setMatches] = useState<boolean | null>(null);

  useEffect(() => {
    const mediaQuery = window.matchMedia(query);
    const synchronize = () => setMatches(mediaQuery.matches);

    synchronize();
    mediaQuery.addEventListener("change", synchronize);
    return () => mediaQuery.removeEventListener("change", synchronize);
  }, [query]);

  return matches;
}
