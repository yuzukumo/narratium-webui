interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  dispose: () => void;
}

async function decodeImage(blob: Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      dispose: () => bitmap.close(),
    };
  }

  const source = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = source;
    await image.decode();
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      dispose: () => URL.revokeObjectURL(source),
    };
  } catch (error) {
    URL.revokeObjectURL(source);
    throw error;
  }
}

export async function createImageThumbnail(
  blob: Blob,
  maxDimension = 640,
  quality = 0.82,
): Promise<Blob> {
  if (!blob.type.startsWith("image/")) {
    throw new Error("The selected file is not an image.");
  }
  if (!Number.isFinite(maxDimension) || maxDimension < 1) {
    throw new Error("The thumbnail size is invalid.");
  }

  const decoded = await decodeImage(blob);
  try {
    if (decoded.width < 1 || decoded.height < 1) {
      throw new Error("The image has invalid dimensions.");
    }
    const scale = Math.min(1, maxDimension / Math.max(decoded.width, decoded.height));
    const width = Math.max(1, Math.round(decoded.width * scale));
    const height = Math.max(1, Math.round(decoded.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) {
      throw new Error("Image processing is unavailable in this browser.");
    }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(decoded.source, 0, 0, width, height);

    const thumbnail = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/webp", quality);
    });
    if (!thumbnail) {
      throw new Error("The image could not be processed.");
    }
    return thumbnail;
  } finally {
    decoded.dispose();
  }
}
