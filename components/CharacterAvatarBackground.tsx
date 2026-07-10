import { useEffect, useState } from "react";
import { getBlob } from "@/lib/data/local-storage";

export function CharacterAvatarBackground({ avatarPath }: { avatarPath: string }) {
  const [bgUrl, setBgUrl] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string;

    async function loadImage() {
      const blob = await getBlob(avatarPath);
      if (blob) {
        objectUrl = URL.createObjectURL(blob);
        setBgUrl(objectUrl);
      } else {
        console.warn("Avatar blob not found for", avatarPath);
      }
    }

    loadImage();

    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [avatarPath]);

  return (
    <div
      className="w-full h-full bg-cover bg-center rounded"
      style={{ backgroundImage: bgUrl ? `url(${bgUrl})` : undefined }}
    />
  );
}
