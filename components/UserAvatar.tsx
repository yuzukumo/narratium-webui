"use client";

import { memo, useEffect, useState } from "react";
import { UserRound } from "lucide-react";
import { invalidateBlobUrl, useBlobUrl } from "@/lib/data/blob-url-cache";

export const USER_AVATAR_KEY = "profile/avatar";
export const USER_AVATAR_CHANGED_EVENT = "narratium:user-avatar-changed";

const UserAvatar = memo(function UserAvatar({ className = "", iconSize = 17 }: { className?: string; iconSize?: number }) {
  const [refreshToken, setRefreshToken] = useState(0);
  const source = useBlobUrl(USER_AVATAR_KEY, refreshToken);

  useEffect(() => {
    const handleAvatarChanged = () => {
      invalidateBlobUrl(USER_AVATAR_KEY);
      setRefreshToken((token) => token + 1);
    };

    window.addEventListener(USER_AVATAR_CHANGED_EVENT, handleAvatarChanged);
    return () => {
      window.removeEventListener(USER_AVATAR_CHANGED_EVENT, handleAvatarChanged);
    };
  }, []);

  return source ? (
    <img src={source} alt="" loading="lazy" decoding="async" className={`h-full w-full object-cover ${className}`} />
  ) : (
    <UserRound size={iconSize} className={className} />
  );
});

export default UserAvatar;
