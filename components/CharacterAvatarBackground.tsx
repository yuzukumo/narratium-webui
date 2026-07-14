import { memo } from "react";
import { useBlobUrl } from "@/lib/data/blob-url-cache";

export const CharacterAvatarBackground = memo(function CharacterAvatarBackground({ avatarPath }: { avatarPath: string }) {
  const bgUrl = useBlobUrl(avatarPath);

  return (
    <div
      className="w-full h-full bg-cover bg-center rounded"
      style={{ backgroundImage: bgUrl ? `url(${bgUrl})` : undefined }}
    />
  );
});
