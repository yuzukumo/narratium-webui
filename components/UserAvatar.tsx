"use client";

import { useEffect, useState } from "react";
import { UserRound } from "lucide-react";
import { getBlob } from "@/lib/data/local-storage";

export const USER_AVATAR_KEY = "profile/avatar";
export const USER_AVATAR_CHANGED_EVENT = "narratium:user-avatar-changed";

export default function UserAvatar({ className = "", iconSize = 17 }: { className?: string; iconSize?: number }) {
  const [source, setSource] = useState<string | null>(null);

  useEffect(() => {
    let objectURL = "";
    let disposed = false;
    const load = async () => {
      try {
        const blob = await getBlob(USER_AVATAR_KEY);
        if (disposed) return;
        if (objectURL) URL.revokeObjectURL(objectURL);
        if (!blob) {
          objectURL = "";
          setSource(null);
          return;
        }
        objectURL = URL.createObjectURL(blob);
        setSource(objectURL);
      } catch {
        if (!disposed) setSource(null);
      }
    };
    void load();
    window.addEventListener(USER_AVATAR_CHANGED_EVENT, load);
    return () => {
      disposed = true;
      window.removeEventListener(USER_AVATAR_CHANGED_EVENT, load);
      if (objectURL) URL.revokeObjectURL(objectURL);
    };
  }, []);

  return source ? (
    <img src={source} alt="" className={`h-full w-full object-cover ${className}`} />
  ) : (
    <UserRound size={iconSize} className={className} />
  );
}
